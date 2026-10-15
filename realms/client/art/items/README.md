# Item illustration library

Original repository-native SVG illustrations created for Follybound: sword,
greatsword, shield, ring, knotted charm, medallion, compass, ore, vial, satchel,
helmet, boots and armor. No third-party images, external resources or scripts.

Use a curated key in an item’s public `itemArt` or `itemIcon` field. The client
only loads explicit allowlisted same-origin assets; it ignores URLs and paths.
Unspecified items use contextual slot/item/category fallbacks. Color is decorative
and never conveys hidden stats or quality. Item names and facts remain normal UI
text. Add new assets to the client key list and static server allowlist together.
