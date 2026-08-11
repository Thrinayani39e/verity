import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from verity.ingestion import CHUNK_OVERLAP, CHUNK_SIZE, _chunk_text


def test_short_text_returns_single_chunk():
    text = "short claim description"
    assert _chunk_text(text) == [text]


def test_long_text_is_split_with_overlap():
    text = "a" * (CHUNK_SIZE * 3)
    chunks = _chunk_text(text)

    assert len(chunks) > 1
    for chunk in chunks:
        assert len(chunk) <= CHUNK_SIZE

    # Consecutive chunks should overlap by CHUNK_OVERLAP characters so a
    # sentence spanning a chunk boundary is never split without context.
    first_tail = chunks[0][-CHUNK_OVERLAP:]
    second_head = chunks[1][:CHUNK_OVERLAP]
    assert first_tail == second_head


def test_blank_text_returns_no_chunks():
    assert _chunk_text("   \n  ") == []
