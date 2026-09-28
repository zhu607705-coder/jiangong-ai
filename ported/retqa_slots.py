"""Selective port of RETQA's restore_keywords_from_query.

Upstream: jensenw1/RETQA, SLUTQA/utils.py
Observed upstream blob: 96dcfee379282dda59a67b2523f447b3765637f0
Copyright (c) 2024 jensen-w. MIT license: ../licenses/RETQA-LICENSE.txt.

Changes: remove unrelated notebook/LLM imports; handle empty input; validate
BIO length; map enterprise to 企业 rather than 城市; expose typed entities so
callers need not parse display strings. This module is NOT a full RETQA port.
"""
from __future__ import annotations
from dataclasses import dataclass
from collections.abc import Sequence

LABELS = {
    'city': '城市', 'district': '区域', 'community': '项目名称',
    'enterprise': '企业', 'year': '年份', 'month': '月份', 'land': '地块名称',
}

@dataclass(frozen=True)
class EntitySlot:
    label: str
    value: str


def extract_entity_slots(query: str, slots: str | Sequence[str]) -> list[EntitySlot]:
    """Reconstruct character-level BIO tags; malformed shapes fail explicitly."""
    tags = slots.split() if isinstance(slots, str) else list(slots)
    if tags and tags[0] == '[CLS]':
        tags = tags[1:]
        if tags and tags[-1] == '[SEP]':
            tags = tags[:-1]
    if not query and not tags:
        return []
    if len(query) != len(tags):
        raise ValueError('Character count and BIO tag count must match.')
    results: list[EntitySlot] = []
    current_tokens: list[str] = []
    current_label: str | None = None

    def flush() -> None:
        if current_tokens and current_label:
            results.append(EntitySlot(current_label, ''.join(current_tokens)))
        current_tokens.clear()

    for token, slot in zip(query, tags):
        if slot.startswith('B-') and len(slot) > 2:
            flush()
            current_label = slot[2:]
            current_tokens.append(token)
        elif slot.startswith('I-') and current_label == slot[2:]:
            current_tokens.append(token)
        elif slot == 'O':
            flush()
            current_label = None
        else:
            raise ValueError(f'Invalid or orphan BIO tag: {slot}')
    flush()
    return results


def restore_keywords_from_query(query: str, slots: str | Sequence[str]) -> list[str]:
    """Compatible display helper; callers should prefer extract_entity_slots."""
    return [f'{LABELS[e.label]}:{e.value}' for e in extract_entity_slots(query, slots)
            if e.label in LABELS]
