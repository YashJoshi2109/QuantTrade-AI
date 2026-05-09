"""LSTM model definition — single source of truth.

Both training (ml.train) and inference (lstm_prediction_service) import from here.
Architecture: input projection → N-layer LSTM → multi-head temporal attention → FC head.
"""

import torch
import torch.nn as nn

from ml.constants import NUM_FEATURES, DEFAULT_HIDDEN_SIZE, DEFAULT_NUM_LAYERS, DEFAULT_DROPOUT


class LSTMPredictor(nn.Module):
    """Multi-head attention LSTM for time-series return prediction.

    Improvements over scalar-attention baseline:
    - Input LayerNorm projection: normalizes raw features before LSTM, improves gradient flow
    - Multi-head temporal attention: richer time-step weighting vs. single linear
    - Residual skip from last hidden state: gradient stability + preserves recency signal

    Input: (batch, seq_len, input_size)
    Output: (batch, 1)
    """

    def __init__(
        self,
        input_size: int = NUM_FEATURES,
        hidden_size: int = DEFAULT_HIDDEN_SIZE,
        num_layers: int = DEFAULT_NUM_LAYERS,
        dropout: float = DEFAULT_DROPOUT,
        num_heads: int = 4,
    ):
        super().__init__()
        self.hidden_size = hidden_size
        self.num_layers = num_layers

        # Project raw features → hidden_size with normalization before LSTM
        self.input_proj = nn.Sequential(
            nn.Linear(input_size, hidden_size),
            nn.LayerNorm(hidden_size),
        )

        self.lstm = nn.LSTM(
            hidden_size, hidden_size, num_layers,
            batch_first=True, dropout=dropout if num_layers > 1 else 0.0,
        )

        # Guarantee num_heads divides hidden_size (e.g. hidden=8, heads=4 → 2 per head)
        _heads = num_heads
        while _heads > 1 and hidden_size % _heads != 0:
            _heads //= 2
        self.mha = nn.MultiheadAttention(
            embed_dim=hidden_size, num_heads=_heads, dropout=dropout, batch_first=True,
        )
        self.attn_norm = nn.LayerNorm(hidden_size)

        # FC head
        self.fc1 = nn.Linear(hidden_size, 64)
        self.fc2 = nn.Linear(64, 1)
        self.dropout = nn.Dropout(dropout)
        self.relu = nn.ReLU()

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        # x: (batch, seq_len, input_size)
        x = self.input_proj(x)                          # (batch, seq_len, hidden_size)
        lstm_out, _ = self.lstm(x)                      # (batch, seq_len, hidden_size)

        # Multi-head attention: query = last timestep, key/value = all timesteps
        query = lstm_out[:, -1:, :]                     # (batch, 1, hidden_size)
        context, _ = self.mha(query, lstm_out, lstm_out)
        context = context.squeeze(1)                    # (batch, hidden_size)

        # Residual + norm: last hidden state preserves recency signal
        last_hidden = lstm_out[:, -1, :]                # (batch, hidden_size)
        out = self.attn_norm(context + last_hidden)

        out = self.relu(self.fc1(out))
        out = self.dropout(out)
        return self.fc2(out)                            # (batch, 1)
