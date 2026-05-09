"""LSTM model definition — single source of truth.

Both training (ml.train) and inference (lstm_prediction_service) import from here.
Architecture: input projection → N-layer LSTM → M×TransformerEncoderBlock → output head.
"""

import torch
import torch.nn as nn

from ml.constants import NUM_FEATURES, DEFAULT_HIDDEN_SIZE, DEFAULT_NUM_LAYERS, DEFAULT_DROPOUT


class TransformerEncoderBlock(nn.Module):
    """Full Transformer encoder block: MHA → Add&Norm → FFN → Add&Norm.

    Matches the encoder side of "Attention Is All You Need" (Vaswani et al., 2017).
    Both Add&Norm operations use post-norm style: LayerNorm(x + sublayer(x)).

    Input/Output: (batch, seq_len, hidden_size)
    """

    def __init__(
        self,
        hidden_size: int,
        num_heads: int,
        ffn_dim: int,
        dropout: float,
    ):
        super().__init__()
        self.mha = nn.MultiheadAttention(
            hidden_size, num_heads, dropout=dropout, batch_first=True,
        )
        self.norm1 = nn.LayerNorm(hidden_size)   # Add & Norm after MHA
        self.ffn = nn.Sequential(
            nn.Linear(hidden_size, ffn_dim),
            nn.GELU(),
            nn.Dropout(dropout),
            nn.Linear(ffn_dim, hidden_size),
        )
        self.norm2 = nn.LayerNorm(hidden_size)   # Add & Norm after FFN
        self.dropout = nn.Dropout(dropout)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        # Self-attention: all timesteps attend to all timesteps
        attn_out, _ = self.mha(x, x, x)
        x = self.norm1(x + self.dropout(attn_out))   # Add & Norm
        ffn_out = self.ffn(x)
        x = self.norm2(x + self.dropout(ffn_out))    # Add & Norm
        return x


class LSTMPredictor(nn.Module):
    """LSTM + stacked Transformer encoder blocks for time-series return prediction.

    Architecture:
        input_proj (Linear + LayerNorm)
        → LSTM (sequential ordering)
        → N × TransformerEncoderBlock (MHA→Add&Norm→FFN→Add&Norm)
        → last timestep → output head

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
        num_encoder_blocks: int = 2,
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

        # Guarantee num_heads divides hidden_size
        _heads = num_heads
        while _heads > 1 and hidden_size % _heads != 0:
            _heads //= 2

        # Stacked Transformer encoder blocks (FFN uses standard 4× expansion)
        ffn_dim = 4 * hidden_size
        self.encoder_blocks = nn.ModuleList([
            TransformerEncoderBlock(hidden_size, _heads, ffn_dim, dropout)
            for _ in range(num_encoder_blocks)
        ])

        self.output_head = nn.Linear(hidden_size, 1)
        self.dropout = nn.Dropout(dropout)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        # x: (batch, seq_len, input_size)
        x = self.input_proj(x)          # (batch, seq_len, hidden_size)
        x, _ = self.lstm(x)             # (batch, seq_len, hidden_size)

        for block in self.encoder_blocks:
            x = block(x)               # MHA→Add&Norm→FFN→Add&Norm each block

        out = self.dropout(x[:, -1, :])  # last timestep (batch, hidden_size)
        return self.output_head(out)     # (batch, 1)
