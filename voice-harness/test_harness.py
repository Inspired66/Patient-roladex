import io
import struct
import unittest

import score
import vocab_check as vc


def sym_table(words):
    def s(t):
        b = t.encode()
        return struct.pack("<i", len(b)) + b
    body = struct.pack("<i", vc.SYMTAB_MAGIC) + s("t") + struct.pack("<qq", len(words), len(words))
    return body + b"".join(s(w) + struct.pack("<q", i) for i, w in enumerate(words))


class VocabTests(unittest.TestCase):
    def test_reads_embedded_output_symbols(self):
        def s(t):
            b = t.encode()
            return struct.pack("<i", len(b)) + b
        hdr = struct.pack("<i", vc.FST_MAGIC) + s("ngram") + s("standard") + struct.pack("<ii", 4, 3)
        hdr += struct.pack("<qqqq", 0, 0, 0, 0)
        data = hdr + sym_table(["<eps>", "in"]) + sym_table(["<eps>", "left", "right"])
        self.assertEqual(set(vc.read_fst_output_symbols(data)), {"<eps>", "left", "right"})

    def test_multiword_and_digits(self):
        rows = vc.check({"left", "knee"}, [("anatomy", "left knee"), ("drug", "cefazolin"),
                                           ("dose", "500 left")])
        self.assertEqual([r["status"] for r in rows], ["ok", "OOV", "spoken-form"])


class ScoreTests(unittest.TestCase):
    def run_one(self, ref, hyp, terms=()):
        return score.score([("t", score.normalise(ref), score.normalise(hyp))], terms)

    def test_wer(self):
        r = self.run_one("the left knee", "the right knee")
        self.assertAlmostEqual(r["wer"], 1 / 3)

    def test_laterality_swap_is_counted(self):
        r = self.run_one("left knee and right hip", "right knee and right hip")
        self.assertEqual(r["categories"]["laterality"]["correct"], 1)
        self.assertEqual(r["categories"]["laterality"]["total"], 2)

    def test_number_span_must_be_exact(self):
        r = self.run_one("give twelve milligrams", "give twenty milligrams")
        self.assertEqual(r["categories"]["numbers"]["correct"], 0)
        r = self.run_one("give twelve milligrams", "give twelve milligrams")
        self.assertEqual(r["categories"]["numbers"]["correct"], 1)

    def test_date_span(self):
        r = self.run_one("on the third of march two thousand twenty", "on the third of march two thousand twenty")
        self.assertEqual(r["categories"]["dates"], {"correct": 1, "total": 1, "accuracy": 1.0})
        r = self.run_one("on the third of march", "on the thirty of march")
        self.assertEqual(r["categories"]["dates"]["correct"], 0)

    def test_terms(self):
        r = self.run_one("start heparin now", "start he parent now", [("drug", ["heparin"])])
        self.assertEqual(r["terms"]["drug"], {"correct": 0, "total": 1, "accuracy": 0.0})


class CompareTests(unittest.TestCase):
    def test_two_engines_one_table(self):
        import os
        import tempfile
        import compare
        with tempfile.TemporaryDirectory() as d:
            samples, out = os.path.join(d, "s"), os.path.join(d, "o")
            for e, hyp in (("a", "give twelve milligrams left"), ("b", "give twenty milligrams right")):
                os.makedirs(os.path.join(out, e))
                open(os.path.join(out, e, "c1.hyp.txt"), "w").write(hyp)
            os.makedirs(samples)
            open(os.path.join(samples, "c1.ref.txt"), "w").write("give twelve milligrams left")
            results = compare.evaluate(samples, out)
            self.assertEqual(list(results), ["a", "b"])
            self.assertEqual(results["a"]["wer"], 0)
            self.assertGreater(results["b"]["wer"], 0)
            text = compare.table(results)
            self.assertEqual(len(text.splitlines()), 4)


if __name__ == "__main__":
    unittest.main()
