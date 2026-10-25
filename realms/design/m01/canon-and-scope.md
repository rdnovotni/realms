# M01 canon and scope — v1.0.0

This version records an implementation contract for FB-009–FB-012. It does not approve new mechanics or promote provisional content. [Catalog provenance](../SOURCE_MANIFEST.md) and [registry process](../README.md) remain authoritative engineering records.

## Authority order

Apply System 46 §3–6 in this exact order: (1) explicit approved correction from project discussion, durably recorded; (2) owning Systems 01–46, with intentional later revisions prevailing; (3) Master Index/Canon Register, which summarizes rather than invents; (4) historical Core; (5) prototype constants/tuning tables within approved constraints; (6) examples, comments and mock content. Document age alone never resolves a contradiction. LOCKED, PROVISIONAL, DEFERRED, SUPERSEDED and EXPERIMENTAL are design dispositions, not implementation maturity.

M01 source facts are confirmed against the bundled bibles; provisional slice selections below are recommendations for implementation review. No new approved correction was inferred from chat, code, filenames or catalog examples. An unretrieved discussion is not evidence of approval. Add any later explicit approval with its durable reference before changing canon.

## Fingerprinted import and correction procedure

1. Keep synced `sources/` read-only. Read the supplied feature-index ZIP as the self-contained delivery of Core + 46 HTML documents; do not reconstruct System 36 from the incomplete original Design Documents ZIP. The bundle records its standalone provenance.
2. Run `python3 infra/scripts/import_design_catalog.py --archive /path/to/kol2_master_feature_index_bundle.zip --output /tmp/new-unique-name.json.gz` from repository root. The importer refuses overwrite/synced output and verifies every HTML size/hash.
3. Compare archive hash, decompressed catalog hash, 47 document hashes, section/entry IDs and the complete correction array. A compressed-byte difference needs explanation; stable IDs are extraction identities, not guarantees that wording stayed unchanged.
4. Diff added/removed/changed sections, wording/status, tiers and correction owners. Record the new source, approval reference, affected extraction IDs, canonical replacement, migration/player-state impact and tests. Unknown/conflicting approval stays unresolved.
5. Preserve implementation evidence/history. Review explicit `supersession_bindings` before exempting any rule; a correction topic alone does not waive all rules in a system. Never mass-promote section status on import.
6. After review replace snapshot and overlay catalog hash together, regenerate reports, run registry/import tests and M01 validation, then review the diff in a versioned PR. Existing frozen checkpoints remain unchanged.
7. If source drift affects this brief, bump its version and reconcile each source reference/issue acceptance; source drift must fail validation until reviewed.

Executed on 2026-10-24: the new import matched repository gzip **byte-for-byte**. The importer verified all source HTML hashes. This verifies the supplied archive, not later private discussions.

| Fingerprint | Value |
|---|---|
| archive_sha256 | `3274e33be64263597af5301b9099012a6357eb87c8cdaf952e1eef4598250c63` |
| catalog_sha256 | `bbb101b37b74f0e85668e18233bd256c18546b14f662c790e574bfba5ba3b18b` |
| corrections_sha256 | `5b94e8fcec8fff004028821b8851857c223279389f50c388f3cd5069310f2fbd` |
| documents | `47` |
| systems | `46` |
| sections | `2096` |
| entries | `13187` |
| corrections | `12` |

Correction hash serialization: UTF-8, `json.dumps(supersessions, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n"`. The uncompressed catalog retains exact source wording, 2,096 sections and 12 corrections. No reference files were rewritten.

## Original obligations and approved supersessions

The original text remains in the catalog. The following are **existing approved corrections**, copied from System 46 §6, not M01 recommendations. Requirement-level exemption still needs an explicit affected-ID/replacement binding in the engineering registry.

| Topic | Owning system | Existing canonical resolution |
|---|---|---|
| PvP / gambling | 39 / 40 | System 39 authorizes eligible Gold wagering including player-versus-player wagering with a mandatory humorous risk tutorial, escrow and heavy anti-laundering/collusion controls. System 40 additionally permits explicit card-for-card stakes for eligible tradable cards. Legal/platform eligibility still gates deployment. |
| Culture selection | 37 | System 37 removes a separate culture-selection subsystem. Cultures exist in the world and can be reflected narratively, but players do not manage a culture build layer. |
| Backgrounds / origins | 37 | System 37 confirms optional narrative origins/backstory only, with no standardized mechanical progression package. |
| Languages | 37 | System 37 simplifies language handling. Languages can matter contextually without becoming a complex character-management subsystem. |
| Wilderness Trek / camps | 33 | Rejected. Travel remains quick-to-instant; wilderness exploration is optional play in the existing world. No dedicated temporary field-camp system. |
| Investigation depth | 38 | Simplified. Investigation is normal RPG/quest gameplay with optional deeper mysteries, not a detective simulator; no dedicated multiplayer investigation subsystem. |
| Subclass roster | 43 | Only the 12 base classes are locked for now. Subclass roster, names and exact packages remain future content design. |
| Ascension lore | 44 | System 44 makes the connection loose and mysterious. Most people do not know or understand Ascension; rare entities may perceive echoes. It can remain a long-term mystery indefinitely. |
| Campaign ending | 44 | System 44 locks a real conclusion to the launch campaign’s immediate central crisis while leaving wider mysteries and future expansion hooks open. |
| Procedural dungeon rooms | 32 | System 32 additionally requires themed random filler rooms for immersion, pacing, believable architecture and surprises. |
| Long-tail scaling | 45 | System 45 clarifies that damage/survivability can continue increasing every level through 999, but on controlled diminishing curves; declared challenge systems scale appropriately without hidden universal enemy mirroring. |
| Gear power | 45 | System 45 clarifies gear is also a major power source and exceptional gear can substantially outperform ordinary gear while build coherence still matters. |

## Launch classifications confirmed

System 46 §8–10: 31 Launch Core, 12 Launch Supporting, 3 Post-Launch Ready; **no whole system is Expansion Candidate**. Core is historical context. Launch Core means production-quality scope at launch, not that all of it belongs in this first slice. Supporting means narrower breadth, not optional by default. Post-Launch Ready preserves contracts without requiring a complete launch feature. Expansion Candidate applies only to explicitly selected future work, not a new M01 system reassignment.

| System | Title | Canonical tier |
|---|---|---|
| Core | Core Design Bible | Foundation / historical context |
| 01 | Turns, Rollover & Daily Economy | Launch Core |
| 02 | Food, Booze, Tolerance & Consumables | Launch Core |
| 03 | Character Progression, Attributes, Classes & Mastery | Launch Core |
| 04 | Tactical Combat, Actions, Positioning, Damage & Conditions | Launch Core |
| 05 | Encounters, Manipulation, Wanderers & Zone State | Launch Core |
| 06 | Quests, Journal, Rumors, Contracts, Bounties & Consequences | Launch Core |
| 07 | Items, Equipment, Inventory, Rarity, Quality & Durability | Launch Core |
| 08 | Crafting, Gathering, Professions, Quality & Maker Economy | Launch Supporting |
| 09 | Familiars, Companions, Hirelings, Summons & Party AI | Launch Core |
| 10 | Ascension, Run Modes, Legacy, DM Tavern & Run History | Launch Core |
| 11 | Economy, Markets, Trade, Gold, Services & Inflation Control | Launch Core |
| 12 | Guilds, Social Systems, Guild Halls, Campaigns & Community | Launch Supporting |
| 13 | Aftercore, Endgame, Raids, Expeditions & Long-Term Progression | Launch Core |
| 14 | Collections, Codex, Museums, Discovery & Rare Finds | Launch Supporting |
| 15 | Events, Holidays, Seasonal Content, World Events & FOMO Control | Post-Launch Ready |
| 16 | Automation, UI, Parser, Information Architecture & Accessibility | Launch Core |
| 17 | Monetization, Supporter Tokens, IOTM Content & Pay-to-Win Boundaries | Launch Supporting |
| 18 | World Structure, Regions, Travel, Maps, Time, Weather & World State | Launch Core |
| 19 | Home, Campground, Housing, Rest, Storage & Personal Infrastructure | Launch Supporting |
| 20 | Deities, Religion, Patrons, Omens, Constellations, Luck & Cosmology | Launch Supporting |
| 21 | Factions, Standing, Politics, Law, Crime & Regional Allegiance | Launch Core |
| 22 | PvP, Duels, Arenas, Async Defense & Competitive Formats | Post-Launch Ready |
| 23 | Server Authority, Game State, Actions, Persistence, Content Runtime & Technical Foundation | Launch Core |
| 24 | Status Effects, Buffs, Debuffs, Diseases, Curses, Resistance, Cleansing & Effect Engine | Launch Core |
| 25 | Death, Defeat, Downed States, Resurrection, Retreat, Surrender & Recovery | Launch Core |
| 26 | Creature Level, Difficulty, Scaling, Enemy Progression & Encounter Challenge | Launch Core |
| 27 | Monsters, Enemy Archetypes, Combat AI, Ecology, Variants & Monster Manual | Launch Core |
| 28 | Loot Tables, Drops, Harvesting, Treasure Generation, Rarity & Reward Distribution | Launch Core |
| 29 | Skills, Proficiencies, Checks, DCs, Contests & Noncombat Resolution | Launch Core |
| 30 | Stealth, Detection, Suspicion, Infiltration, Disguises, Trespassing & Heists | Launch Supporting |
| 31 | Traps, Locks, Environmental Hazards, Puzzles & Dungeon Interaction | Launch Supporting |
| 32 | Dungeons, Expeditions, Instances, Checkpoints, Procedural Generation & Exploration Rewards | Launch Core |
| 33 | Travel, Wilderness Exploration, Navigation, Survival & Overland Encounters | Launch Supporting |
| 34 | NPCs, Dialogue, Relationships, Memory, Schedules & Social Interaction | Launch Core |
| 35 | Magic, Spellcasting, Rituals, Spell Research & Magical World Interaction | Launch Core |
| 36 | Martial Techniques, Weapon Styles, Combat Maneuvers & Nonmagical Ability Mastery | Launch Core |
| 37 | Playable Species, Heritage, Origins & Character Identity | Launch Core |
| 38 | Investigation, Evidence, Secrets, Rumors & Mystery Solving | Launch Supporting |
| 39 | Taverns, Games, Festivals, Minigames & Social Activities | Launch Supporting |
| 40 | Collectible Card Game, Deckbuilding, Card Acquisition & Tournaments | Post-Launch Ready |
| 41 | Monster Taming, Capturing, Training & Creature Companionship | Launch Supporting |
| 42 | Boss Encounters, Raid Mechanics, World Bosses & Group Challenges | Launch Core |
| 43 | Classes, Subclasses, Feats & Signature Abilities | Launch Core |
| 44 | Worldbuilding, Lore, Main Campaign & Narrative Structure | Launch Core |
| 45 | Game Balance, Progression Curves & Numerical Tuning | Launch Core |
| 46 | Final Integration, Contradiction Audit, Content Production & Development Roadmap | Launch Core |

## System 46 §10 subfeature overrides

- System 39: ordinary taverns/recreation are Launch Supporting; high-stakes wagering remains eligibility- and operationally gated. This is a gate, not permission to switch it on.
- System 42: ordinary bosses are Launch Core; full server-wide world-boss campaigns may be Post-Launch Ready.
- Systems 13/32: meaningful Aftercore and at least one Expedition-style endgame loop are Launch Core; extreme endless-depth breadth grows later. Slice Aftercore entry alone does not close this launch obligation.
- System 22: plan PvP architecture from the beginning; mature ranked/async formats may arrive later.
- System 40: launch integration points may precede the full Post-Launch Ready card ecosystem.
- System 15: event framework architecture precedes launch; large live cadence waits for operational readiness.

These six overrides are not a wholesale deferral of their parent systems. None is silently promoted to an unconditional shipped promise.

## Four separate decision ledgers

| Ledger | Examples | Handling |
|---|---|---|
| Original design obligation | 2–3 slice classes, companion, complete first/second life, typed authoring, natural-language approved intents; S46 §§11–14 | Required slice acceptance; never trade away silently |
| Approved supersession | Twelve corrections above, including unknown Ascension metaphysics, no culture/background system and deferred subclasses | Apply recorded canon and map affected source IDs before implementation |
| Unresolved design/content decisions | Final names/map, exact species traits, final 6–10 regions/campaign antagonist/endings, Familiar cost, class engines/tuning and native mechanics details | Remain open; assign owner, evidence and deadline below |
| M01 recommendation | Brackenford plot, Fighter/Rogue/Wizard, human/goblin, Survey knowledge reward, issue sequence and numerical playtest thresholds | Provisional content/production plan; not new LOCKED canon |

| Decision ID | Open item / owner | Resolution gate |
|---|---|---|
| D-M01-01 | Region/names/antagonist and ending text — campaign | Narrative review before SL-05 content seal; reject contradictions without retconning Core obligations |
| D-M01-02 | Human/goblin exact bounded traits and anatomy — identity | SL-04 schema/budget review; all three classes viable, no stacked heritage packages |
| D-M01-03 | Native class resource choices and low-level progression — progression | SL-04 class-engine proof; examples are not enough |
| D-M01-04 | Familiar cost/benefit — companions | SL-04 spike; include one path if inexpensive or explicitly record evidence and deferral against S46 §11 |
| D-M01-05 | Budget/levels/Turn targets and playtest thresholds — balance | Versioned tuning review before SL-07/SL-10; no production constants fixed here |
| D-M01-06 | Implementation of persistent clue discovery — content-knowledge | SL-03/SL-08 scope review; reuse discoveries, no numeric Mastery substitute |
| D-M01-07 | Operational identities / adoption — operator | FB-006 evidence before readiness/activation claim; design can proceed |

Final species roster is content approval work; the slice pair does not replace the substantial curated launch target in S37 §2/7. Twelve base classes remain the S43 §6 launch foundation; no subclass roster is frozen. No M01 recommendation alters those obligations.
