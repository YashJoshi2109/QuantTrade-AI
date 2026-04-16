"""LSTM model definition — single source of truth.

Both training (ml.train) and inference (lstm_prediction_service) import from here.
Architecture: 3-layer LSTM + attention pooling + 2 FC layers.
"""

import torch
import torch.nn as nn

from ml.constants import NUM_FEATURES, DEFAULT_HIDDEN_SIZE, DEFAULT_NUM_LAYERS, DEFAULT_DROPOUT


class LSTMPredictor(nn.Module):
    """Attention-based LSTM for time-series regression/classification.

    Input: (batch, seq_len, input_size)
    Output: (batch, 1)
    """

    def __init__(
        self,
        input_size: int = NUM_FEATURES,
        hidden_size: int = DEFAULT_HIDDEN_SIZE,
        num_layers: int = DEFAULT_NUM_LAYERS,
        dropout: float = DEFAULT_DROPOUT,
    ):
        super().__init__()
        self.hidden_size = hidden_size
        self.num_layers = num_layers

        self.lstm = nn.LSTM(
            input_size, hidden_size, num_layers,
            batch_first=True, dropout=dropout if num_layers > 1 else 0.0,
        )
        # Attention over time steps
        self.attention = nn.Linear(hidden_size, 1)
        # FC head
        self.fc1 = nn.Linear(hidden_size, 64)
        self.fc2 = nn.Linear(64, 1)
        self.dropout = nn.Dropout(dropout)
        self.relu = nn.ReLU()

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        # x: (batch, seq_len, input_size)
        lstm_out, _ = self.lstm(x)  # (batch, seq_len, hidden_size)

        # Attention: weight each time step
        attn_weights = torch.softmax(self.attention(lstm_out), dim=1)  # (batch, seq_len, 1)
        context = (lstm_out * attn_weights).sum(dim=1)  # (batch, hidden_size)

        out = self.relu(self.fc1(context))
        out = self.dropout(out)
        out = self.fc2(out)  # (batch, 1)
        return out
