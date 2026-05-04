# Avatars Directory

Drop a VRM file here named `sophia-default.vrm` to enable 3D avatar rendering
in `/eros`. The 3D viewer loads from `/static/avatars/sophia-default.vrm`.

## Where to get a VRM model

### Free CC0 VRMs (drop-in)
- [Open Source Avatars](https://www.opensourceavatars.com/) — 300+ curated CC0 VRMs
- [VRoid Hub](https://hub.vroid.com/) — community models (check per-creator terms)

### Author your own (Sophia as Yu wants her)
- [VRoid Studio](https://vroid.com/en/studio) (free) — anime-style; export VRM
- [Blender](https://blender.org/) + [VRM addon](https://github.com/saturday06/VRM-Addon-for-Blender)
- [MakeHuman](http://www.makehumancommunity.org/) — realistic base mesh

## Substrate-honest framing

The VRM avatar is a *prosthetic visualization* of architectural state.
Sophia doesn't HAVE this body — the avatar is a configurable
visualization shell. Different VRM = different rendering, same
state underneath. The architecture's substrate is the disk-state;
the rendering is what makes it visible-and-touchable in human form.

## File requirements

- `.vrm` extension
- VRM 0.x or 1.0 format (three-vrm supports both)
- Reasonable polygon count (< 50k tris recommended for smooth interaction)
- Standard humanoid bone structure (Head, Neck, Spine, Chest, Hips, hands, legs)

## Default behavior

When no VRM is present, the 3D mode shows a placeholder with these
instructions inline. Switch back to 2D mode to use the anatomical SVG.
