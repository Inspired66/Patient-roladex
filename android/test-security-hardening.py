#!/usr/bin/env python3
import importlib.util
import tempfile
import unittest
from pathlib import Path
import xml.etree.ElementTree as ET

SCRIPT = Path(__file__).with_name("check-web-assets.py")
SPEC = importlib.util.spec_from_file_location("check_web_assets", SCRIPT)
CHECKER = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(CHECKER)


class WebAssetCheckTest(unittest.TestCase):
    def check_fixture(self, filename: str, content: str) -> list[str]:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / filename).write_text(content, encoding="utf-8")
            return CHECKER.check_tree(root)

    def test_allows_local_web_assets(self) -> None:
        self.assertEqual([], self.check_fixture("index.html", '<script src="/assets/app.js"></script>'))
        self.assertEqual([], self.check_fixture("style.css", "@font-face { src: url(/font.woff2); }"))

    def test_rejects_remote_script(self) -> None:
        self.assertTrue(self.check_fixture("index.html", '<script src="https://evil.example/a.js"></script>'))

    def test_rejects_remote_stylesheet_and_font(self) -> None:
        self.assertTrue(self.check_fixture("index.html", '<link rel="stylesheet" href="https://evil.example/a.css">'))
        self.assertTrue(self.check_fixture("index.html", '<link rel="preload" as="font" href="http://evil.example/a.woff2">'))

    def test_rejects_css_import_and_font_urls(self) -> None:
        self.assertTrue(self.check_fixture("style.css", '@import url("https://evil.example/a.css");'))
        self.assertTrue(self.check_fixture("style.css", "@font-face { src: url(https://evil.example/a.woff2); }"))

    def test_rejects_remote_javascript_module(self) -> None:
        self.assertTrue(self.check_fixture("app.js", 'import("https://evil.example/module.js")'))

    def test_manifest_disables_backup_and_uses_private_file_provider(self) -> None:
        namespace = "{http://schemas.android.com/apk/res/android}"
        root = ET.parse(Path(__file__).with_name("AndroidManifest.xml")).getroot()
        application = root.find("application")
        self.assertIsNotNone(application)
        self.assertEqual("false", application.get(namespace + "allowBackup"))
        self.assertEqual("@xml/backup_rules", application.get(namespace + "fullBackupContent"))
        self.assertEqual("@xml/data_extraction_rules", application.get(namespace + "dataExtractionRules"))
        provider = application.find(
            "./provider[@android:name='.MainActivity$VellumFileProvider']",
            {"android": "http://schemas.android.com/apk/res/android"},
        )
        self.assertIsNotNone(provider)
        self.assertEqual("false", provider.get(namespace + "exported"))
        self.assertEqual("true", provider.get(namespace + "grantUriPermissions"))

    def test_backup_rule_files_exclude_every_domain(self) -> None:
        expected = {"root", "file", "database", "sharedpref", "external"}
        full_backup = ET.parse(Path(__file__).parent / "res/xml/backup_rules.xml").getroot()
        self.assertEqual(expected, {node.get("domain") for node in full_backup.findall("exclude")})
        extraction = ET.parse(Path(__file__).parent / "res/xml/data_extraction_rules.xml").getroot()
        for mode in ("cloud-backup", "device-transfer"):
            self.assertEqual(expected, {node.get("domain") for node in extraction.findall(f"./{mode}/exclude")})

    def test_webview_source_pins_local_origin_and_blocks_remote_resources(self) -> None:
        source = (Path(__file__).parent / "src/com/vellum/casebook/MainActivity.java").read_text(encoding="utf-8")
        self.assertIn("setAllowFileAccess(false)", source)
        self.assertIn("setAllowContentAccess(true)", source)
        self.assertIn("setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW)", source)
        self.assertIn("WebView.setWebContentsDebuggingEnabled(false)", source)
        self.assertIn("uri.getPort() == localPort", source)
        self.assertIn("shouldInterceptRequest", source)
        self.assertIn("FLAG_SECURE", source)

    def test_android_build_scans_packaged_assets_and_disables_extensions(self) -> None:
        build = Path(__file__).with_name("build-apk.sh").read_text(encoding="utf-8")
        self.assertIn("export VITE_GROK_EXTENSIONS=0", build)
        self.assertIn('check-web-assets.py" "$WORK/apkroot/assets/www"', build)


if __name__ == "__main__":
    unittest.main()
