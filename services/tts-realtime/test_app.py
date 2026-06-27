import importlib
import unittest
from unittest.mock import patch

import numpy as np


class OmniVoiceBackendTests(unittest.TestCase):
    def setUp(self):
        self.app = importlib.import_module("app")

    def test_default_model_id_is_omnivoice(self):
        self.assertEqual(self.app.OMNIVOICE_MODEL_ID, "k2-fsa/OmniVoice")

    def test_default_speed_is_slowed_to_user_requested_value(self):
        self.assertEqual(self.app.DEFAULT_TTS_SPEED, 0.65)
        self.assertEqual(self.app.normalize_speed(None), 0.65)

    def test_default_num_step_uses_fast_mode(self):
        self.assertEqual(self.app.OMNIVOICE_NUM_STEP, 10)
        self.assertEqual(self.app.OMNIVOICE_SYNTHESIS_ATTEMPTS, 2)

    def test_normalize_speed_rejects_non_positive_values(self):
        with self.assertRaises(ValueError):
            self.app.normalize_speed(0)

    def test_synthesize_wav_passes_speed_language_and_num_step_to_omnivoice(self):
        class FakeModel:
            sampling_rate = 24000

            def __init__(self):
                self.calls = []

            def generate(self, **kwargs):
                self.calls.append(kwargs)
                return [np.zeros(2400, dtype=np.float32)]

        fake_model = FakeModel()

        with patch.object(self.app, "_load_model", return_value=fake_model):
            wav_bytes, sample_rate = self.app.synthesize_wav("shalom", language="he", speed=0.7)

        self.assertGreater(len(wav_bytes), 44)
        self.assertEqual(sample_rate, 24000)
        self.assertEqual(fake_model.calls[0]["text"], "shalom")
        self.assertEqual(fake_model.calls[0]["language"], "he")
        self.assertEqual(fake_model.calls[0]["speed"], 0.7)
        self.assertEqual(fake_model.calls[0]["num_step"], self.app.OMNIVOICE_NUM_STEP)

    def test_hebrew_voice_uses_young_voice_design_instruction(self):
        class FakeModel:
            sampling_rate = 24000

            def __init__(self):
                self.calls = []

            def generate(self, **kwargs):
                self.calls.append(kwargs)
                return [np.zeros(2400, dtype=np.float32)]

        fake_model = FakeModel()

        with patch.object(self.app, "_load_model", return_value=fake_model):
            wav_bytes, sample_rate = self.app.synthesize_wav(
                "shalom",
                language="he",
                voice="omnivoice-he",
                speed=0.65,
            )

        self.assertGreater(len(wav_bytes), 44)
        self.assertEqual(sample_rate, 24000)
        self.assertIn("young adult", fake_model.calls[0]["instruct"])
        self.assertIn("high pitch", fake_model.calls[0]["instruct"])

    def test_synthesize_wav_retries_transient_generation_failures(self):
        class FlakyModel:
            sampling_rate = 24000

            def __init__(self):
                self.calls = 0

            def generate(self, **kwargs):
                self.calls += 1
                if self.calls == 1:
                    raise ValueError("zero-size array to reduction operation maximum which has no identity")
                return [np.zeros(2400, dtype=np.float32)]

        fake_model = FlakyModel()

        with patch.object(self.app, "_load_model", return_value=fake_model):
            wav_bytes, sample_rate = self.app.synthesize_wav("shalom", language="he", speed=0.65)

        self.assertGreater(len(wav_bytes), 44)
        self.assertEqual(sample_rate, 24000)
        self.assertEqual(fake_model.calls, 2)


if __name__ == "__main__":
    unittest.main()
