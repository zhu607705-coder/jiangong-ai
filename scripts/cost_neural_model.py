"""Small, serializable NumPy BP adapter for an explicitly labelled cost example.

The network has two tanh hidden layers and a linear normalized-log-price output.
Full-batch Adam updates its weights using explicit backpropagation. This CPU
adapter is not a reproduction of the paper's MATLAB ``trainlm`` implementation.
Data selection, target stage, PSO search and independent evaluation belong to
the caller. Only fitting rows determine the feature and log-target scalers.

Weights use the input-by-output layout: ``x @ weights + bias``. JSON lists and
the saved scalers are sufficient to repeat the forward pass in another runtime.
There is no executable/pickle state in the returned model.
"""
from __future__ import annotations

import math
import time
from collections.abc import Callable, Mapping, Sequence
from typing import Any

import numpy as np


MODEL_VERSION = "cost-bp-numpy-1"
Layer = dict[str, np.ndarray]


class TrainingCancelled(RuntimeError):
    """A caller-provided cancellation signal or monotonic deadline stopped fit."""


def _positive_integer(value: Any, name: str) -> int:
    if isinstance(value, (bool, np.bool_)) or not isinstance(value, (int, np.integer)) or value < 1:
        raise ValueError(f"{name} must be a positive integer")
    return int(value)


def _finite_number(value: Any, name: str, *, positive: bool = False) -> float:
    if isinstance(value, (bool, np.bool_)) or not isinstance(value, (int, float, np.number)):
        raise ValueError(f"{name} must be a finite number")
    number = float(value)
    if not math.isfinite(number) or (number <= 0 if positive else number < 0):
        raise ValueError(f"{name} must be {'positive' if positive else 'nonnegative'} and finite")
    return number


def _features(values: Any, *, expected_columns: int | None = None) -> np.ndarray:
    try:
        array = np.asarray(values, dtype=np.float64)
    except (TypeError, ValueError) as error:
        raise ValueError("features must be a finite two-dimensional numeric array") from error
    if array.ndim != 2 or array.shape[0] < 1 or array.shape[1] < 1 or not np.isfinite(array).all():
        raise ValueError("features must be a finite nonempty two-dimensional numeric array")
    if expected_columns is not None and array.shape[1] != expected_columns:
        raise ValueError(f"expected {expected_columns} feature columns, received {array.shape[1]}")
    return array


def _targets(values: Any, rows: int, *, positive: bool) -> np.ndarray:
    try:
        array = np.asarray(values, dtype=np.float64)
    except (TypeError, ValueError) as error:
        raise ValueError("targets must be a finite one-dimensional numeric array") from error
    if array.ndim != 1 or array.shape[0] != rows or not np.isfinite(array).all():
        raise ValueError("targets must be a finite one-dimensional array matching the feature rows")
    if positive and np.any(array <= 0):
        raise ValueError("unit-price targets must be strictly positive for the log transform")
    return array


def _hidden_widths(hidden: Sequence[int]) -> tuple[int, int]:
    if not isinstance(hidden, (tuple, list)) or len(hidden) != 2:
        raise ValueError("hidden must contain exactly two positive layer widths")
    return (_positive_integer(hidden[0], "hidden[0]"), _positive_integer(hidden[1], "hidden[1]"))


def initialize_network_parameters(input_size: int, hidden: Sequence[int], seed: int) -> list[Layer]:
    """Return deterministic Glorot-uniform weights and zero biases, without fit."""
    width = _positive_integer(input_size, "input_size")
    hidden_widths = _hidden_widths(hidden)
    if isinstance(seed, (bool, np.bool_)) or not isinstance(seed, (int, np.integer)) or seed < 0:
        raise ValueError("seed must be a nonnegative integer")
    rng = np.random.default_rng(int(seed))
    dimensions = (width, *hidden_widths, 1)
    layers: list[Layer] = []
    for incoming, outgoing in zip(dimensions[:-1], dimensions[1:]):
        limit = math.sqrt(6.0 / (incoming + outgoing))
        layers.append({"weights": rng.uniform(-limit, limit, (incoming, outgoing)),
                       "bias": np.zeros(outgoing, dtype=np.float64)})
    return layers


def _load_layers(parameters: Sequence[Mapping[str, Any]]) -> list[Layer]:
    if not isinstance(parameters, (list, tuple)) or len(parameters) != 3:
        raise ValueError("parameters must contain two hidden layers and one output layer")
    layers: list[Layer] = []
    previous_width: int | None = None
    for item in parameters:
        if not isinstance(item, Mapping) or "weights" not in item or "bias" not in item:
            raise ValueError("each layer must contain weights and bias")
        try:
            weights = np.asarray(item["weights"], dtype=np.float64)
            bias = np.asarray(item["bias"], dtype=np.float64)
        except (TypeError, ValueError) as error:
            raise ValueError("layer parameters must be finite numeric arrays") from error
        if (weights.ndim != 2 or min(weights.shape) < 1 or bias.shape != (weights.shape[1],)
                or not np.isfinite(weights).all() or not np.isfinite(bias).all()):
            raise ValueError("layer weights/bias must have compatible finite shapes")
        if previous_width is not None and weights.shape[0] != previous_width:
            raise ValueError("adjacent layer dimensions must match")
        previous_width = weights.shape[1]
        layers.append({"weights": weights, "bias": bias})
    if layers[-1]["weights"].shape[1] != 1:
        raise ValueError("the output layer must have one value per row")
    return layers


def _forward_arrays(layers: Sequence[Layer], x: np.ndarray) -> tuple[np.ndarray, list[np.ndarray]]:
    activations = [x]
    with np.errstate(over="raise", invalid="raise", divide="raise"):
        for index, layer in enumerate(layers):
            linear = activations[-1] @ layer["weights"] + layer["bias"]
            if not np.isfinite(linear).all():
                raise FloatingPointError("nonfinite network activation")
            activations.append(np.tanh(linear) if index < 2 else linear)
    return activations[-1][:, 0], activations


def network_forward(parameters: Sequence[Mapping[str, Any]], normalized_x: Any) -> np.ndarray:
    """Return normalized log-price values, without applying saved data scalers."""
    layers = _load_layers(parameters)
    x = _features(normalized_x, expected_columns=layers[0]["weights"].shape[0])
    prediction, _ = _forward_arrays(layers, x)
    return prediction


def _loss_gradients_arrays(layers: Sequence[Layer], x: np.ndarray, y: np.ndarray,
                          l2: float) -> tuple[float, list[Layer], float]:
    prediction, activations = _forward_arrays(layers, x)
    with np.errstate(over="raise", invalid="raise", divide="raise"):
        residual = prediction - y
        data_loss = float(np.mean(residual ** 2))
        penalty = 0.5 * l2 * sum(float(np.sum(layer["weights"] ** 2)) for layer in layers)
        loss = data_loss + penalty
        if not math.isfinite(loss):
            raise FloatingPointError("nonfinite network loss")
        delta = (2.0 / len(y)) * residual[:, None]
        reverse_gradients: list[Layer] = []
        for index in range(len(layers) - 1, -1, -1):
            layer = layers[index]
            reverse_gradients.append({
                "weights": activations[index].T @ delta + l2 * layer["weights"],
                "bias": np.sum(delta, axis=0),
            })
            if index > 0:
                delta = (delta @ layer["weights"].T) * (1.0 - activations[index] ** 2)
    gradients = list(reversed(reverse_gradients))
    if not all(np.isfinite(value).all() for gradient in gradients for value in gradient.values()):
        raise FloatingPointError("nonfinite network gradient")
    return loss, gradients, data_loss


def network_loss_gradients(parameters: Sequence[Mapping[str, Any]], normalized_x: Any,
                           normalized_y: Any, l2: float = 0.0) -> tuple[float, list[Layer]]:
    """Return MSE plus ``0.5*l2*sum(weights**2)`` and its analytic gradients.

    Biases are unpenalized. This independent mathematical function has no
    optimizer or fitting side effects and can be checked by finite differences.
    """
    layers = _load_layers(parameters)
    x = _features(normalized_x, expected_columns=layers[0]["weights"].shape[0])
    y = _targets(normalized_y, len(x), positive=False)
    penalty = _finite_number(l2, "l2")
    loss, gradients, _ = _loss_gradients_arrays(layers, x, y, penalty)
    return loss, gradients


def fit_network(x_train: Any, y_train: Any, hidden: Sequence[int], learning_rate: float,
                l2: float, epochs: int, seed: int, *, gradient_clip: float = 5.0,
                should_stop: Callable[[], bool] | None = None, deadline: float | None = None,
                history_points: int = 25) -> dict[str, Any]:
    """Fit only the supplied training rows and return a JSON-serializable model.

    ``deadline`` is an absolute ``time.monotonic()`` timestamp. Cancellation
    raises ``TrainingCancelled`` rather than returning a partially fitted model.
    The caller owns dataset admission and the compute budget before invoking fit.
    Loss history includes initialization and the final model, with at most
    ``history_points`` entries. There is no validation/test data input here.
    """
    iterations = _positive_integer(epochs, "epochs")
    trace_count = _positive_integer(history_points, "history_points")
    if trace_count < 2:
        raise ValueError("history_points must be at least two")
    rate = _finite_number(learning_rate, "learning_rate", positive=True)
    penalty = _finite_number(l2, "l2")
    clip = _finite_number(gradient_clip, "gradient_clip", positive=True)
    if should_stop is not None and not callable(should_stop):
        raise ValueError("should_stop must be callable")
    if deadline is not None:
        deadline = _finite_number(deadline, "deadline", positive=True)

    def check_stop() -> None:
        if ((deadline is not None and time.monotonic() >= deadline)
                or (should_stop is not None and should_stop())):
            raise TrainingCancelled("network fitting stopped by caller or deadline")

    check_stop()
    x = _features(x_train)
    if len(x) < 2:
        raise ValueError("fitting requires at least two training rows")
    y = _targets(y_train, len(x), positive=True)
    layers = initialize_network_parameters(x.shape[1], hidden, seed)
    with np.errstate(over="raise", invalid="raise", divide="raise"):
        x_mean = np.mean(x, axis=0)
        x_std = np.std(x, axis=0)
        x_std = np.where(x_std == 0.0, 1.0, x_std)
        normalized_x = (x - x_mean) / x_std
        log_y = np.log(y)
        log_y_mean = float(np.mean(log_y))
        log_y_std = float(np.std(log_y)) or 1.0
        normalized_y = (log_y - log_y_mean) / log_y_std
    if not np.isfinite(normalized_x).all() or not np.isfinite(normalized_y).all():
        raise FloatingPointError("nonfinite training normalization")

    moments = [{key: np.zeros_like(value) for key, value in layer.items()} for layer in layers]
    velocities = [{key: np.zeros_like(value) for key, value in layer.items()} for layer in layers]
    trace_epochs = {round(index * iterations / (min(trace_count, iterations + 1) - 1))
                    for index in range(min(trace_count, iterations + 1))}
    history: list[dict[str, int | float]] = []
    clipped_steps = 0
    beta1, beta2, epsilon = 0.9, 0.999, 1e-8
    for epoch in range(iterations + 1):
        check_stop()
        loss, gradients, data_loss = _loss_gradients_arrays(layers, normalized_x, normalized_y, penalty)
        with np.errstate(over="raise", invalid="raise", divide="raise"):
            norm = math.sqrt(sum(float(np.sum(value ** 2)) for gradient in gradients
                                 for value in gradient.values()))
        if not math.isfinite(norm):
            raise FloatingPointError("nonfinite gradient norm")
        if epoch in trace_epochs:
            history.append({"epoch": epoch, "loss": loss, "data_loss": data_loss,
                            "gradient_norm": norm})
        if epoch == iterations:
            break
        scale = min(1.0, clip / norm) if norm > 0.0 else 1.0
        clipped_steps += int(scale < 1.0)
        step = epoch + 1
        with np.errstate(over="raise", invalid="raise", divide="raise"):
            for index, layer in enumerate(layers):
                for key in ("weights", "bias"):
                    gradient = gradients[index][key] * scale
                    moments[index][key] = beta1 * moments[index][key] + (1.0 - beta1) * gradient
                    velocities[index][key] = beta2 * velocities[index][key] + (1.0 - beta2) * gradient ** 2
                    corrected_moment = moments[index][key] / (1.0 - beta1 ** step)
                    corrected_velocity = velocities[index][key] / (1.0 - beta2 ** step)
                    layer[key] = layer[key] - rate * corrected_moment / (np.sqrt(corrected_velocity) + epsilon)
                    if not np.isfinite(layer[key]).all():
                        raise FloatingPointError("nonfinite updated network parameter")
    check_stop()
    return {
        "model_version": MODEL_VERSION,
        "architecture": {"input_features": x.shape[1], "hidden": list(_hidden_widths(hidden)),
                         "activation": "tanh", "output_activation": "linear", "target_transform": "log"},
        "x_scaler": {"mean": x_mean.tolist(), "std": x_std.tolist()},
        "log_y_scaler": {"mean": log_y_mean, "std": log_y_std},
        "layers": [{key: value.tolist() for key, value in layer.items()} for layer in layers],
        "training": {"rows": len(x), "epochs": iterations, "seed": int(seed),
                     "learning_rate": rate, "l2": penalty, "gradient_clip": clip,
                     "clipped_steps": clipped_steps, "optimizer": "full_batch_adam",
                     "loss": "normalized_log_mse_plus_half_l2_weights",
                     "adapter": "NumPy CPU BP; not MATLAB trainlm reproduction", "history": history},
    }


def predict_network(model: Mapping[str, Any], x: Any) -> np.ndarray:
    """Restore JSON parameters/scalers and return finite strictly positive prices.

    Values that overflow or underflow the exponential raise an error. The model
    does not silently clip them into an apparently valid price range.
    """
    if not isinstance(model, Mapping) or model.get("model_version") != MODEL_VERSION:
        raise ValueError("unsupported network model_version")
    try:
        architecture = model["architecture"]
        if (architecture["activation"] != "tanh" or architecture["output_activation"] != "linear"
                or architecture["target_transform"] != "log"):
            raise ValueError("unsupported saved network architecture")
        layers = _load_layers(model["layers"])
        columns = layers[0]["weights"].shape[0]
        if architecture["input_features"] != columns or architecture["hidden"] != [
                layers[0]["weights"].shape[1], layers[1]["weights"].shape[1]]:
            raise ValueError("saved architecture does not match parameter dimensions")
        x_mean = np.asarray(model["x_scaler"]["mean"], dtype=np.float64)
        x_std = np.asarray(model["x_scaler"]["std"], dtype=np.float64)
        y_mean = float(model["log_y_scaler"]["mean"])
        y_std = float(model["log_y_scaler"]["std"])
    except (KeyError, TypeError) as error:
        raise ValueError("saved model is missing valid parameters or scalers") from error
    if (x_mean.shape != (columns,) or x_std.shape != (columns,) or not np.isfinite(x_mean).all()
            or not np.isfinite(x_std).all() or np.any(x_std <= 0)
            or not math.isfinite(y_mean) or not math.isfinite(y_std) or y_std <= 0):
        raise ValueError("saved scalers must have compatible shapes and positive finite scales")
    features = _features(x, expected_columns=columns)
    with np.errstate(over="raise", invalid="raise", divide="raise", under="raise"):
        normalized_x = (features - x_mean) / x_std
        normalized_log_y, _ = _forward_arrays(layers, normalized_x)
        log_y = normalized_log_y * y_std + y_mean
        prices = np.exp(log_y)
    if not np.isfinite(prices).all() or np.any(prices <= 0):
        raise FloatingPointError("predicted prices are not finite and strictly positive")
    return prices
