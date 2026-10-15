# Item illustration library

Original repository-native SVG illustrations created for Follybound: sword,
greatsword, shield, ring, knotted charm, medallion, compass, ore, vial, satchel,
helmet, boots and armor. No third-party images, external resources or scripts.

Use a curated key in an item’s public `itemArt` or `itemIcon` field. The client
only loads explicit allowlisted same-origin assets; it ignores URLs and paths.
Unspecified items use contextual slot/item/category fallbacks. Color is decorative
and never conveys hidden stats or quality. Item names and facts remain normal UI
text. Add new assets to the client key list and static server allowlist together.

Item-specific raster artwork may be authored separately from the built-in vectors.
Put a reviewed PNG, WebP, JPG or AVIF in `client/art/items/authored/` and set the
item definition's public `itemArt` to `authored/<filename>`. The filename must be
lowercase letters/digits/hyphen/underscore, 1–80 characters before the extension.
`itemIcon` also accepts this form. Paths, external URLs, query strings and SVG
uploads are rejected. The static handler serves only this fixed local directory;
CSP and nosniff remain enabled. Missing images fall back to a known icon/context
illustration and finally the neutral glyph. Both tile and paperdoll use this same
hierarchy. No raster artwork is invented for unauthored content.
