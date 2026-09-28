"""Selective port from GeoAgent, MIT; Strands registration intentionally excluded."""
from __future__ import annotations
from dataclasses import asdict, dataclass, field
from typing import Any

@dataclass
class GeoToolMeta:
    """Metadata for a registered Strands tool."""

    name: str
    description: str = ""
    category: str = "general"
    requires_confirmation: bool = False
    destructive: bool = False
    long_running: bool = False
    available_in: tuple[str, ...] = ("full",)
    requires_packages: tuple[str, ...] = ()
    extra: dict[str, Any] = field(default_factory=dict)

    @property
    def needs_confirmation(self) -> bool:
        """
        Determine whether user confirmation is required

        Returns:
            True if confirmation should be required before execution
        """
        return self.requires_confirmation or self.destructive or self.long_running

    def to_dict(self) -> dict[Any, Any]:
        """
        Convert metadata into serial dictionary

        Returns:
            Dictionary representation of the metadata
        """
        data = asdict(self)

        data["available_in"] = list(self.available_in)
        data["requires_packages"] = list(self.requires_packages)

        return data

def get_geo_meta(tool_obj: Any) -> dict[str, Any]:
    """Return GeoAgent metadata as a plain dict for callbacks / UIs."""
    meta: GeoToolMeta | None = getattr(tool_obj, "_geoagent_meta", None)
    if meta is None:
        return {}
    return {
        "category": meta.category,
        "requires_confirmation": meta.requires_confirmation,
        "destructive": meta.destructive,
        "long_running": meta.long_running,
        "available_in": meta.available_in,
        "requires_packages": meta.requires_packages,
        **meta.extra,
    }

def stamp_geo_meta(tool_obj: Any, **fields: Any) -> Any:
    """Attach or merge :class:`GeoToolMeta` fields on a Strands tool."""
    meta: GeoToolMeta | None = getattr(tool_obj, "_geoagent_meta", None)
    if meta is None:
        name = getattr(tool_obj, "tool_name", "unknown")
        meta = GeoToolMeta(name=str(name))
    for k, v in fields.items():
        if hasattr(meta, k):
            setattr(meta, k, v)
    setattr(tool_obj, "_geoagent_meta", meta)
    return tool_obj

def needs_confirmation(tool_obj: Any) -> bool:
    """Return True if tool should use the confirmation callback."""
    meta: GeoToolMeta | None = getattr(tool_obj, "_geoagent_meta", None)
    if meta is None:
        return False
    return bool(meta.requires_confirmation or meta.destructive or meta.long_running)
