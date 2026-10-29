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

    def test_case_punctuation_and_british_spelling(self):
        self.assertEqual(score.normalise(" ANAESTHETIC's, oesophageal! "),
                         ["anaesthetics", "oesophageal"])
        r = self.run_one("ANAESTHETIC, oesophageal!", "anesthetic. esophageal?")
        self.assertEqual(r["wer"], 0)
        self.assertEqual(r["spelling_variants"], {
            "count": 2,
            "pairs": {
                "anaesthetic/anesthetic": 1,
                "oesophageal/esophageal": 1,
            },
        })

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
        r = self.run_one("start lignocaine now", "start lidocaine now", [("drug", ["lignocaine"])])
        self.assertEqual(r["terms"]["drug"], {"correct": 1, "total": 1, "accuracy": 1.0})


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
                open(os.path.join(out, e, "noisy1.hyp.txt"), "w").write("noisy sample")
            os.makedirs(samples)
            open(os.path.join(samples, "c1.ref.txt"), "w").write("give twelve milligrams left")
            open(os.path.join(samples, "noisy1.ref.txt"), "w").write("noisy sample")
            results = compare.evaluate(samples, out)
            clean_results = compare.evaluate(samples, out, clean_only=True)
            self.assertEqual(list(results), ["a", "b"])
            self.assertEqual(results["a"]["wer"], 0)
            self.assertEqual(clean_results["a"]["counts"]["N"], 4)
            self.assertGreater(results["b"]["wer"], 0)
            text = compare.table(results)
            self.assertEqual(len(text.splitlines()), 4)
            self.assertIn("Spelling-only", text)


class GateTests(unittest.TestCase):
    DRUGS = {("ropivacaine",), ("bupivacaine",), ("levobupivacaine",), ("lidocaine",), ("lignocaine",),
             ("glyceryl", "trinitrate")}

    def classify(self, ref, hyp):
        import gate
        import score
        return [r[1:] for r in gate.classify_drugs("c", score.normalise(ref), score.normalise(hyp), self.DRUGS)]

    def test_exact_and_different_real_drug(self):
        self.assertEqual(self.classify("give ropivacaine", "give ropivacaine"), [("exact", "ropivacaine", "ropivacaine")])
        self.assertEqual(self.classify("give ropivacaine", "give bupivacaine"), [("other_drug", "ropivacaine", "bupivacaine")])

    def test_prefix_drug_is_a_different_drug(self):
        self.assertEqual(self.classify("give bupivacaine", "give levobupivacaine"),
                         [("other_drug", "bupivacaine", "levobupivacaine")])

    def test_synonym_and_garbled(self):
        self.assertEqual(self.classify("give lignocaine", "give lidocaine")[0][0], "variant")
        self.assertEqual(self.classify("give ropivacaine", "give rope of a cane"),
                         [("garbled", "ropivacaine", "rope of a cane")])
        self.assertEqual(self.classify("give ropivacaine now", "give now"), [("garbled", "ropivacaine", "(nothing)")])

    def test_spelling_variant_is_not_a_different_drug(self):
        import gate
        ref = score.normalise("give magnesium sulphate")
        hyp = score.normalise("give magnesium sulfate")
        drugs = {("magnesium", "sulphate"), ("magnesium", "sulfate")}
        self.assertEqual(gate.classify_drugs("c", ref, hyp, drugs),
                         [("c", "variant", "magnesium sulphate", "magnesium sulfate")])

    def test_multiword_drug(self):
        self.assertEqual(self.classify("glyceryl trinitrate spray", "glyceryl trinitrate spray")[0][0], "exact")

    def test_verdict_uses_clean_clips_only(self):
        import gate
        import os
        import tempfile
        with tempfile.TemporaryDirectory() as d:
            samples, out = os.path.join(d, "s"), os.path.join(d, "o", "e")
            os.makedirs(samples)
            os.makedirs(out)
            terms = os.path.join(d, "t.txt")
            open(terms, "w").write("drug: ropivacaine\ndrug: bupivacaine\n")
            for name, ref, hyp in (("clean1", "ropivacaine left", "ropivacaine left"),
                                   ("noisy1", "ropivacaine left", "bupivacaine right")):
                open(os.path.join(samples, name + ".ref.txt"), "w").write(ref)
                open(os.path.join(out, name + ".hyp.txt"), "w").write(hyp)
            text = gate.run(samples, os.path.dirname(out), terms)
            self.assertNotIn("NO-GO", text.split("Noisy clips")[0])
            self.assertIn("1/1 (wrong/total)", text.split("Noisy clips")[1])

    def test_status_thresholds(self):
        import gate
        self.assertEqual(gate.status(0.03, False, 0.02, 0.05), "CONDITIONAL")
        self.assertEqual(gate.status(0.06, False, 0.02, 0.05), "FAIL")
        self.assertEqual(gate.status(0.90, True, 0.90, 0.75), "PASS")
        self.assertEqual(gate.status(0.74, True, 0.90, 0.75), "FAIL")


class PromptTests(unittest.TestCase):
    def test_priority_budget_and_no_prefixes(self):
        import build_prompt
        terms = [("anatomy", ["femur"]), ("drug", ["propofol"]), ("drug", ["propofol"]), ("drug", ["cefazolin"])]
        self.assertEqual(build_prompt.build(terms, 600, "P:"), "P: propofol, cefazolin, femur.")
        self.assertEqual(build_prompt.build(terms, 22, "P:"), "P: propofol.")


if __name__ == "__main__":
    unittest.main()
