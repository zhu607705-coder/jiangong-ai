"""Selective MIT port of StormInformationTable.construct_url_to_info.

Original: stanford-oval/storm, see research/upstream.lock.json and LICENSE.
Patches: immutable inputs; stable snippet order; no encoder/DSPy runtime.
"""
from copy import deepcopy
from dataclasses import dataclass, field


@dataclass
class Information:
    url: str
    title: str
    snippets: list[str] = field(default_factory=list)


@dataclass
class DialogueTurn:
    search_results: list[Information]


def construct_url_to_info(conversations: list[tuple[str, list[DialogueTurn]]]) -> dict[str, Information]:
    url_to_info = {}
    for persona, conv in conversations:
        for turn in conv:
            for storm_info in turn.search_results:
                if storm_info.url in url_to_info:
                    url_to_info[storm_info.url].snippets.extend(storm_info.snippets)
                else:
                    url_to_info[storm_info.url] = deepcopy(storm_info)
    for url in url_to_info:
        url_to_info[url].snippets = list(dict.fromkeys(url_to_info[url].snippets))
    return url_to_info
