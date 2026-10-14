"""Pure mathematical/serialization checks; these tests do not run fitting."""
import copy
import json
import unittest

import numpy as np

from scripts.cost_neural_model import (
    MODEL_VERSION,
    initialize_network_parameters,
    network_forward,
    network_loss_gradients,
    predict_network,
)


class CostNeuralModelTests(unittest.TestCase):
    def setUp(self):
        self.layers = initialize_network_parameters(2, (3, 2), seed=47)
        self.x = np.array([[-0.8, 0.3], [0.2, -0.4], [0.7, 0.9]])
        self.y = np.array([-0.5, 0.1, 0.8])

    def model(self):
        return {
            "model_version": MODEL_VERSION,
            "architecture": {"input_features": 2, "hidden": [3, 2], "activation": "tanh",
                             "output_activation": "linear", "target_transform": "log"},
            "x_scaler": {"mean": [100.0, 5.0], "std": [20.0, 1.0]},
            "log_y_scaler": {"mean": float(np.log(350.0)), "std": 0.2},
            "layers": [{key: value.tolist() for key, value in layer.items()} for layer in self.layers],
        }

    def test_initialization_is_deterministic_without_fitting(self):
        matching = initialize_network_parameters(2, (3, 2), seed=47)
        different = initialize_network_parameters(2, (3, 2), seed=48)
        for original, repeated in zip(self.layers, matching):
            np.testing.assert_array_equal(original["weights"], repeated["weights"])
            np.testing.assert_array_equal(original["bias"], repeated["bias"])
        self.assertFalse(np.array_equal(self.layers[0]["weights"], different[0]["weights"]))

    def test_backprop_matches_finite_differences_for_every_parameter(self):
        step = 1e-6
        _, gradients = network_loss_gradients(self.layers, self.x, self.y, l2=0.07)
        before = copy.deepcopy(self.layers)
        for layer_index, layer in enumerate(self.layers):
            for key, values in layer.items():
                for index in np.ndindex(values.shape):
                    upper = copy.deepcopy(self.layers)
                    lower = copy.deepcopy(self.layers)
                    upper[layer_index][key][index] += step
                    lower[layer_index][key][index] -= step
                    upper_loss, _ = network_loss_gradients(upper, self.x, self.y, l2=0.07)
                    lower_loss, _ = network_loss_gradients(lower, self.x, self.y, l2=0.07)
                    numerical = (upper_loss - lower_loss) / (2.0 * step)
                    self.assertAlmostEqual(gradients[layer_index][key][index], numerical, places=7)
        for original, unchanged in zip(before, self.layers):
            for key in original:
                np.testing.assert_array_equal(original[key], unchanged[key])

    def test_l2_penalizes_weights_and_leaves_bias_gradients_unpenalized(self):
        plain_loss, plain_gradients = network_loss_gradients(self.layers, self.x, self.y)
        l2 = 0.1
        loss, gradients = network_loss_gradients(self.layers, self.x, self.y, l2=l2)
        expected_penalty = 0.5 * l2 * sum(np.sum(layer["weights"] ** 2) for layer in self.layers)
        self.assertAlmostEqual(loss - plain_loss, expected_penalty)
        for layer, plain, penalized in zip(self.layers, plain_gradients, gradients):
            np.testing.assert_allclose(penalized["weights"] - plain["weights"], l2 * layer["weights"])
            np.testing.assert_array_equal(penalized["bias"], plain["bias"])

    def test_serialized_forward_matches_explicit_train_scalers(self):
        model = self.model()
        restored = json.loads(json.dumps(model, allow_nan=False))
        raw_features = np.array([[84.0, 5.3], [104.0, 4.6], [114.0, 5.9]])
        prediction = predict_network(restored, raw_features)
        expected = np.exp(network_forward(self.layers, self.x) * 0.2 + np.log(350.0))
        np.testing.assert_allclose(prediction, expected, rtol=1e-13)
        np.testing.assert_array_equal(prediction, predict_network(model, raw_features))
        self.assertTrue(np.all(prediction > 0.0))

    def test_prediction_is_independent_of_other_prediction_rows(self):
        model = self.model()
        row = np.array([[84.0, 5.3]])
        alone = predict_network(model, row)
        batched = predict_network(model, np.vstack([row, [10000.0, -1000.0]]))
        np.testing.assert_allclose(alone, batched[:1], rtol=1e-14)

    def test_invalid_network_shapes_and_nonfinite_inputs_are_rejected(self):
        with self.assertRaises(ValueError):
            network_forward(self.layers, [[1.0]])
        with self.assertRaises(ValueError):
            network_forward(self.layers, [[np.nan, 1.0]])
        broken = copy.deepcopy(self.layers)
        broken[1]["weights"] = np.zeros((4, 2))
        with self.assertRaises(ValueError):
            network_loss_gradients(broken, self.x, self.y)
        with self.assertRaises(ValueError):
            network_loss_gradients(self.layers, self.x, [1.0])
        with self.assertRaises(ValueError):
            initialize_network_parameters(2, (3,), seed=47)

    def test_overflow_and_underflow_raise_instead_of_clipping_prices(self):
        for mean in (1000.0, -1000.0):
            model = self.model()
            model["log_y_scaler"]["mean"] = mean
            with self.assertRaises(FloatingPointError):
                predict_network(model, [[100.0, 5.0]])

    def test_saved_scaler_and_architecture_validation(self):
        model = self.model()
        model["x_scaler"]["std"][0] = 0.0
        with self.assertRaises(ValueError):
            predict_network(model, [[100.0, 5.0]])
        model = self.model()
        model["architecture"]["hidden"] = [4, 2]
        with self.assertRaises(ValueError):
            predict_network(model, [[100.0, 5.0]])


if __name__ == "__main__":
    unittest.main()
