import type pg from 'pg';

/** Explicit native-field manifest. Policies document the existing domain handlers;
 * generic scoped fields execute their immutable registered Ascension policy.
 * New tables/columns in the owned-state boundary require a reviewed manifest update. */
export const lifetimeRoots=["combat_quickslot_events","consumption_events","meal_plans","consumption_item_preferences","turn_preferences","daily_allowances","daily_allowance_events","accounts", "characters", "runs", "state_scopes", "state_contracts", "scoped_state", "run_progression", "run_consumption", "inventory_items", "inventory_containers", "wallets", "discoveries", "resource_pools", "effect_instances", "instances", "guilds", "guild_members", "world_events", "worlds", "feature_controls", "feature_control_events", "release_adoptions", "inventory_quantity_order"];
export const lifetimeFields=[
{"table": "scene_states", "scope": "RUN", "fields": {"run_id": "ARCHIVE", "scene_id": "ARCHIVE", "release_id": "ARCHIVE", "definition_revision": "ARCHIVE", "state": "ARCHIVE", "revision": "ARCHIVE"}, "reason": "Scene objects, local guard awareness, source claims and physical clues archive with the run. New lives start from the pinned authored baseline."},{"table": "scene_events", "scope": "RUN", "fields": {"id": "ARCHIVE", "account_id": "ARCHIVE", "run_id": "ARCHIVE", "scene_id": "ARCHIVE", "release_id": "ARCHIVE", "definition_revision": "ARCHIVE", "action_id": "ARCHIVE", "object_id": "ARCHIVE", "choice_id": "ARCHIVE", "success": "ARCHIVE", "before_state": "ARCHIVE", "after_state": "ARCHIVE", "result": "ARCHIVE", "committed_revision": "ARCHIVE", "created_at": "ARCHIVE"}, "reason": "Scene objects, local guard awareness, source claims and physical clues archive with the run. New lives start from the pinned authored baseline."},{"table": "scene_outcome_claims", "scope": "RUN", "fields": {"run_id": "ARCHIVE", "principal_id": "ARCHIVE", "event_id": "ARCHIVE"}, "reason": "Scene objects, local guard awareness, source claims and physical clues archive with the run. New lives start from the pinned authored baseline."},
{"table": "npc_conversation_events", "scope": "RUN", "fields": {"id": "ARCHIVE", "account_id": "ARCHIVE", "run_id": "ARCHIVE", "npc_id": "ARCHIVE", "release_id": "ARCHIVE", "definition_revision": "ARCHIVE", "action_id": "ARCHIVE", "before_node": "ARCHIVE", "after_node": "ARCHIVE", "choice_id": "ARCHIVE", "label": "ARCHIVE", "response": "ARCHIVE", "consequence": "ARCHIVE", "memory": "ARCHIVE", "evidence": "ARCHIVE", "committed_revision": "ARCHIVE", "created_at": "ARCHIVE"}, "reason": "Authored NPC conversations and run memories archive with their source life. Only currently approved account-memory exceptions can be read in another life; raw free text is never retained."},
{"table": "quest_events", "scope": "RUN", "fields": {"id": "ARCHIVE", "account_id": "ARCHIVE", "run_id": "ARCHIVE", "quest_id": "ARCHIVE", "release_id": "ARCHIVE", "definition_revision": "ARCHIVE", "action_id": "ARCHIVE", "kind": "ARCHIVE", "before_state": "ARCHIVE", "after_state": "ARCHIVE", "evidence": "ARCHIVE", "rewards": "ARCHIVE", "created_at": "ARCHIVE"}, "reason": "Quest decisions, sources and principal claims archive with the old run; the next life starts fresh."},{"table": "quest_outcome_claims", "scope": "RUN", "fields": {"run_id": "ARCHIVE", "principal_id": "ARCHIVE", "cycle": "ARCHIVE", "event_id": "ARCHIVE"}, "reason": "Quest decisions, sources and principal claims archive with the old run; the next life starts fresh."},{"table": "quest_source_claims", "scope": "RUN", "fields": {"run_id": "ARCHIVE", "source_id": "ARCHIVE", "source_kind": "ARCHIVE", "event_id": "ARCHIVE"}, "reason": "Quest decisions, sources and principal claims archive with the old run; the next life starts fresh."},{"table": "journal_records", "scope": "ACCOUNT", "fields": {"id": "KEEP", "account_id": "KEEP", "run_id": "KEEP", "scope": "KEEP", "world_id": "KEEP", "kind": "KEEP", "subject_id": "KEEP", "text": "KEEP", "source": "KEEP", "credibility": "KEEP", "action_id": "KEEP", "created_at": "KEEP"}, "reason": "Immutable personal information retains provenance. ACCOUNT and WORLD records persist; RUN records remain archived and are excluded in the next life."},
{"table": "rollover_policy_receipts", "scope": "RUN", "fields": {"run_id": "ARCHIVE", "epoch": "ARCHIVE", "release_id": "ARCHIVE", "policy": "ARCHIVE"}, "reason": "Each daily grant retains its effective release policy; Ascension cannot edit an old grant or reapply its epoch."},
{"table": "tactical_rest_events", "scope": "RUN", "fields": {"id": "ARCHIVE", "action_id": "ARCHIVE", "run_id": "ARCHIVE", "after_instance_id": "ARCHIVE", "previous_rest_id": "ARCHIVE", "release_id": "ARCHIVE", "entity_id": "ARCHIVE", "entity_revision": "ARCHIVE", "before_health": "ARCHIVE", "before_mana": "ARCHIVE", "health": "ARCHIVE", "mana": "ARCHIVE", "max_health": "ARCHIVE", "max_mana": "ARCHIVE"}, "reason": "Rest recovery is immutable run evidence; the next life cannot reuse a previous health pool."},
{"table":"combat_quickslot_events","scope":"ACCOUNT","fields":{"id":"KEEP","account_id":"KEEP","action_id":"KEEP","slots":"KEEP","created_at":"KEEP"},"reason":"Immutable prepared-slot choices retain physical item identities across lives; combat still requires current carried custody."},
{"table":"tactical_plans","scope":"RUN","fields":{"id":"ARCHIVE","run_id":"ARCHIVE","instance_id":"ARCHIVE","max_actions":"ARCHIVE","max_mana":"ARCHIVE","min_health":"ARCHIVE","heal_below":"ARCHIVE","completed":"ARCHIVE","spent_mana":"ARCHIVE","status":"ARCHIVE","stop_reason":"ARCHIVE","created_at":"ARCHIVE"},"reason":"Finite combat jobs retain their budgets and stop evidence with their source run; Ascension never resumes a previous fight."},
{"table": "consumption_events", "scope": "ACCOUNT", "fields": {"id": "KEEP", "run_id": "KEEP", "account_id": "KEEP", "kind": "KEEP", "action_id": "KEEP", "request_id": "KEEP", "operation_id": "KEEP", "item_id": "KEEP", "source_event_id": "KEEP", "epoch": "KEEP", "before_balance": "KEEP", "after_balance": "KEEP", "policy": "KEEP", "turn_delta": "KEEP", "confirmed_overdrink": "KEEP", "committed_revision": "KEEP", "shared_before": "KEEP", "shared_after": "KEEP", "migrated": "KEEP", "created_at": "KEEP"}, "reason": "Consumption knowledge, one account-wide undo and saved meal presets persist; active meal execution remains with its run. Rollover alone resets declared capacity tracks."},{"table": "meal_plans", "scope": "ACCOUNT", "fields": {"id": "KEEP", "account_id": "KEEP", "name": "KEEP", "lines": "KEEP", "deleted": "KEEP", "revision": "KEEP", "created_at": "KEEP"}, "reason": "Consumption knowledge, one account-wide undo and saved meal presets persist; active meal execution remains with its run. Rollover alone resets declared capacity tracks."},{"table": "consumption_item_preferences", "scope": "ACCOUNT", "fields": {"item_id": "KEEP", "account_id": "KEEP", "never_auto": "KEEP", "nightcap": "KEEP"}, "reason": "Consumption knowledge, one account-wide undo and saved meal presets persist; active meal execution remains with its run. Rollover alone resets declared capacity tracks."},{"table": "meal_plan_runs", "scope": "RUN", "fields": {"id": "ARCHIVE", "account_id": "ARCHIVE", "run_id": "ARCHIVE", "plan_id": "ARCHIVE", "plan_revision": "ARCHIVE", "lines": "ARCHIVE", "rollovers": "ARCHIVE", "completed": "ARCHIVE", "status": "ARCHIVE", "stop_reason": "ARCHIVE", "created_at": "ARCHIVE"}, "reason": "Consumption knowledge, one account-wide undo and saved meal presets persist; active meal execution remains with its run. Rollover alone resets declared capacity tracks."},
{"table": "turn_plans", "scope": "RUN", "fields": {"id": "ARCHIVE", "account_id": "ARCHIVE", "run_id": "ARCHIVE", "entity_id": "ARCHIVE", "max_turns": "ARCHIVE", "max_actions": "ARCHIVE", "spent": "ARCHIVE", "completed": "ARCHIVE", "min_health": "ARCHIVE", "target_item_id": "ARCHIVE", "target_quantity": "ARCHIVE", "status": "ARCHIVE", "stop_reason": "ARCHIVE", "created_at": "ARCHIVE"}, "reason": "Bounded plans remain with their run. Ascension cannot continue or replenish an old plan."},
{"table": "turn_preferences", "scope": "ACCOUNT", "fields": {"account_id": "KEEP", "reserve": "KEEP"}, "reason": "Account daily budgets and their immutable provenance survive Ascension; no life transition grants a refresh."},{"table": "daily_allowances", "scope": "ACCOUNT", "fields": {"account_id": "KEEP", "entity_id": "KEEP", "charges": "KEEP", "auto_collect": "KEEP", "manual_uses": "KEEP"}, "reason": "Account daily budgets and their immutable provenance survive Ascension; no life transition grants a refresh."},{"table": "daily_allowance_events", "scope": "ACCOUNT", "fields": {"ledger_request_id":"KEEP","auto_collect":"KEEP","id": "KEEP", "account_id": "KEEP", "entity_id": "KEEP", "run_id": "KEEP", "release_id": "KEEP", "entity_revision": "KEEP", "epoch": "KEEP", "action_id": "KEEP", "kind": "KEEP", "before_charges": "KEEP", "after_charges": "KEEP", "turn_bonus": "KEEP", "created_at": "KEEP"}, "reason": "Account daily budgets and their immutable provenance survive Ascension; no life transition grants a refresh."},
  {
    "table": "accounts",
    "scope": "ACCOUNT",
    "fields": {
      "id": "KEEP",
      "created_at": "KEEP",
      "access_status": "KEEP",
      "security_epoch": "KEEP"
    },
    "reason": "Identity, access and security epochs survive lives."
  },
  {
    "table": "character_encounter_snapshots",
    "scope": "RUN",
    "fields": {
      "instance_id": "ARCHIVE",
      "run_id": "ARCHIVE",
      "profile_id": "ARCHIVE",
      "release_id": "ARCHIVE",
      "profile_revision": "ARCHIVE",
      "build_event_id": "ARCHIVE",
      "attribute_choice_id": "ARCHIVE",
      "equipment_event_id": "ARCHIVE",
      "inputs": "ARCHIVE",
      "derived": "ARCHIVE",
      "created_at": "ARCHIVE"
    },
    "reason": "Retain old-run facts, immutable evidence and projections; next life has fresh domain setup and cannot reuse old campaign/choice evidence."
  },
  {
    "table": "characters",
    "scope": "CHARACTER",
    "fields": {
      "id": "KEEP",
      "account_id": "KEEP"
    },
    "reason": "Stable owner and identity survive lives."
  },
  {
    "table": "combat_run_state",
    "scope": "RUN",
    "fields": {
      "run_id": "ARCHIVE",
      "release_id": "ARCHIVE",
      "profile_id": "ARCHIVE",
      "profile_kind": "ARCHIVE",
      "profile_revision": "ARCHIVE",
      "health": "ARCHIVE",
      "max_health": "ARCHIVE",
      "location": "ARCHIVE",
      "last_instance_id": "ARCHIVE"
    },
    "reason": "Retain old-run facts, immutable evidence and projections; next life has fresh domain setup and cannot reuse old campaign/choice evidence."
  },
  {
    "table": "combat_states",
    "scope": "RUN",
    "fields": {
      "instance_id": "ARCHIVE",
      "run_id": "ARCHIVE",
      "release_id": "ARCHIVE",
      "profile_id": "ARCHIVE",
      "profile_kind": "ARCHIVE",
      "profile_revision": "ARCHIVE",
      "monster_id": "ARCHIVE",
      "monster_kind": "ARCHIVE",
      "monster_revision": "ARCHIVE",
      "player_health": "ARCHIVE",
      "player_max_health": "ARCHIVE",
      "enemy_health": "ARCHIVE",
      "enemy_max_health": "ARCHIVE",
      "round": "ARCHIVE",
      "revision": "ARCHIVE",
      "outcome": "ARCHIVE"
    },
    "reason": "Retain old-run facts, immutable evidence and projections; next life has fresh domain setup and cannot reuse old campaign/choice evidence."
  },
  {
    "table": "companion_tactical_recoveries",
    "scope": "RUN",
    "fields": {
      "id": "ARCHIVE",
      "instance_id": "ARCHIVE",
      "run_id": "ARCHIVE",
      "companion_id": "ARCHIVE",
      "companion_kind": "ARCHIVE",
      "action_id": "ARCHIVE",
      "health": "ARCHIVE",
      "mana": "ARCHIVE",
      "terminal_state": "ARCHIVE",
      "rescued": "ARCHIVE",
      "effects": "ARCHIVE"
    },
    "reason": "Retain old-run facts, immutable evidence and projections; next life has fresh domain setup and cannot reuse old campaign/choice evidence."
  },
  {
    "table": "craft_records",
    "scope": "RUN",
    "fields": {
      "action_id": "ARCHIVE",
      "run_id": "ARCHIVE",
      "release_id": "ARCHIVE",
      "recipe_id": "ARCHIVE",
      "definition_kind": "ARCHIVE",
      "definition_revision": "ARCHIVE",
      "batches": "ARCHIVE",
      "output_operation_id": "ARCHIVE",
      "created_at": "ARCHIVE"
    },
    "reason": "Retain old-run facts, immutable evidence and projections; next life has fresh domain setup and cannot reuse old campaign/choice evidence."
  },
  {
    "table": "discoveries",
    "scope": "ACCOUNT",
    "fields": {
      "account_id": "KEEP",
      "entity_id": "KEEP",
      "knowledge_level": "KEEP",
      "first_run_id": "KEEP",
      "discovered_at": "KEEP"
    },
    "reason": "Knowledge retains its first-run provenance; campaign victory learns its canonical ID once."
  },
  {
    "table": "effect_instances",
    "scope": "SCOPED",
    "fields": {
      "id": "OWNER",
      "scope_id": "OWNER",
      "effect_id": "OWNER",
      "definition_kind": "OWNER",
      "release_id": "OWNER",
      "definition_revision": "OWNER",
      "source_ref": "OWNER",
      "stacks": "OWNER",
      "clock": "OWNER",
      "remaining": "OWNER",
      "snapshot": "OWNER"
    },
    "reason": "Run effects archive with their owner; independent-owner effects follow their declared clocks."
  },
  {
    "table": "encounter_records",
    "scope": "RUN",
    "fields": {
      "instance_id": "ARCHIVE",
      "run_id": "ARCHIVE",
      "release_id": "ARCHIVE",
      "definition_id": "ARCHIVE",
      "definition_kind": "ARCHIVE",
      "definition_revision": "ARCHIVE",
      "start_action_id": "ARCHIVE",
      "finish_action_id": "ARCHIVE",
      "turn_cost": "ARCHIVE",
      "revision": "ARCHIVE",
      "checkpoint": "ARCHIVE",
      "outcome": "ARCHIVE",
      "settlement": "ARCHIVE",
      "created_at": "ARCHIVE",
      "finished_at": "ARCHIVE"
    },
    "reason": "Retain old-run facts, immutable evidence and projections; next life has fresh domain setup and cannot reuse old campaign/choice evidence."
  },
  {
    "table": "encounter_xp_plans",
    "scope": "RUN",
    "fields": {
      "instance_id": "ARCHIVE",
      "run_id": "ARCHIVE",
      "release_id": "ARCHIVE",
      "curve_id": "ARCHIVE",
      "curve_kind": "ARCHIVE",
      "curve_revision": "ARCHIVE",
      "amount": "ARCHIVE",
      "commit_action_id": "ARCHIVE",
      "created_at": "ARCHIVE"
    },
    "reason": "Retain old-run facts, immutable evidence and projections; next life has fresh domain setup and cannot reuse old campaign/choice evidence."
  },
  {
    "table": "equipment_events",
    "scope": "RUN",
    "fields": {
      "id": "ARCHIVE",
      "action_id": "ARCHIVE",
      "run_id": "ARCHIVE",
      "revision": "ARCHIVE",
      "before_state": "ARCHIVE",
      "after_state": "ARCHIVE",
      "reason": "ARCHIVE",
      "created_at": "ARCHIVE",
      "proficiency_evidence": "ARCHIVE"
    },
    "reason": "Retain old-run facts, immutable evidence and projections; next life has fresh domain setup and cannot reuse old campaign/choice evidence."
  },
  {
    "table": "equipment_loadout_events",
    "scope": "RUN",
    "fields": {
      "id": "ARCHIVE",
      "loadout_id": "ARCHIVE",
      "character_id": "ARCHIVE",
      "template_key": "ARCHIVE",
      "run_id": "ARCHIVE",
      "action_id": "ARCHIVE",
      "revision": "ARCHIVE",
      "before_state": "ARCHIVE",
      "after_state": "ARCHIVE",
      "reason": "ARCHIVE",
      "equipment_event_id": "ARCHIVE",
      "created_at": "ARCHIVE"
    },
    "reason": "Retain old-run facts, immutable evidence and projections; next life has fresh domain setup and cannot reuse old campaign/choice evidence."
  },
  {
    "table": "equipment_slots",
    "scope": "RUN",
    "fields": {
      "run_id": "ARCHIVE",
      "set_id": "ARCHIVE",
      "slot": "ARCHIVE",
      "item_id": "ARCHIVE"
    },
    "reason": "Retain old-run facts, immutable evidence and projections; next life has fresh domain setup and cannot reuse old campaign/choice evidence."
  },
  {
    "table": "guild_members",
    "scope": "GUILD",
    "fields": {
      "guild_id": "KEEP",
      "account_id": "KEEP",
      "role": "KEEP"
    },
    "reason": "Membership survives character lives."
  },
  {
    "table": "guilds",
    "scope": "GUILD",
    "fields": {
      "id": "KEEP",
      "name": "KEEP",
      "created_at": "KEEP"
    },
    "reason": "Independent shared lifetime."
  },
  {
    "table": "instance_participants",
    "scope": "RUN",
    "fields": {
      "instance_id": "ARCHIVE",
      "run_id": "ARCHIVE",
      "joined_at": "ARCHIVE"
    },
    "reason": "Retain old-run facts, immutable evidence and projections; next life has fresh domain setup and cannot reuse old campaign/choice evidence."
  },
  {
    "table": "instances",
    "scope": "INSTANCE",
    "fields": {
      "id": "ARCHIVE",
      "kind": "ARCHIVE",
      "content_release_id": "ARCHIVE",
      "lifecycle": "ARCHIVE",
      "seed": "ARCHIVE",
      "rng_version": "ARCHIVE",
      "revision": "ARCHIVE",
      "state": "ARCHIVE",
      "created_at": "ARCHIVE",
      "expires_at": "ARCHIVE"
    },
    "reason": "Active participants block Ascension; terminal seeds, rules, state and results remain history."
  },
  {
    "table": "inventory_containers",
    "scope": "SCOPED",
    "fields": {
      "id": "CUSTODY",
      "scope_id": "CUSTODY",
      "kind": "CUSTODY",
      "label": "CUSTODY"
    },
    "reason": "Old containers retained; next carried container fresh; account storage survives."
  },
  {
    "table": "inventory_items",
    "scope": "SCOPED",
    "fields": {
      "id": "CUSTODY",
      "container_id": "CUSTODY",
      "definition_id": "CUSTODY",
      "definition_kind": "CUSTODY",
      "release_id": "CUSTODY",
      "definition_revision": "CUSTODY",
      "storage_mode": "CUSTODY",
      "quantity": "CUSTODY",
      "quality": "CUSTODY",
      "binding": "CUSTODY",
      "bound_account_id": "CUSTODY",
      "bound_run_id": "CUSTODY",
      "source_code": "CUSTODY",
      "created_at": "CUSTODY",
      "metadata": "CUSTODY"
    },
    "reason": "Keep physical identity, quantity, binding, provenance and metadata; eligible run custody moves to Home/Material Vault; bound quest/run units archive."
  },
  {
    "table": "inventory_lock_events",
    "scope": "RUN",
    "fields": {
      "id": "ARCHIVE",
      "item_id": "ARCHIVE",
      "action_id": "ARCHIVE",
      "run_id": "ARCHIVE",
      "revision": "ARCHIVE",
      "previous_locked": "ARCHIVE",
      "locked": "ARCHIVE",
      "created_at": "ARCHIVE"
    },
    "reason": "Retain old-run facts, immutable evidence and projections; next life has fresh domain setup and cannot reuse old campaign/choice evidence."
  },
  {
    "table": "item_binding_events",
    "scope": "RUN",
    "fields": {
      "id": "ARCHIVE",
      "item_id": "ARCHIVE",
      "equipment_event_id": "ARCHIVE",
      "action_id": "ARCHIVE",
      "run_id": "ARCHIVE",
      "bound_account_id": "ARCHIVE",
      "previous_binding": "ARCHIVE",
      "binding": "ARCHIVE",
      "created_at": "ARCHIVE"
    },
    "reason": "Retain old-run facts, immutable evidence and projections; next life has fresh domain setup and cannot reuse old campaign/choice evidence."
  },
  {
    "table": "owned_companions",
    "scope": "RUN",
    "fields": {
      "account_id": "ARCHIVE",
      "companion_id": "ARCHIVE",
      "companion_kind": "ARCHIVE",
      "companion_revision": "ARCHIVE",
      "run_id": "ARCHIVE",
      "release_id": "ARCHIVE",
      "action_id": "ARCHIVE"
    },
    "reason": "Retain old-run facts, immutable evidence and projections; next life has fresh domain setup and cannot reuse old campaign/choice evidence."
  },
  {
    "table": "quest_states",
    "scope": "RUN",
    "fields": {
      "run_id": "ARCHIVE",
      "quest_id": "ARCHIVE",
      "definition_kind": "ARCHIVE",
      "release_id": "ARCHIVE",
      "definition_revision": "ARCHIVE",
      "lifecycle": "ARCHIVE",
      "node_id": "ARCHIVE",
      "state": "ARCHIVE",
      "revision": "ARCHIVE"
    },
    "reason": "Retain old-run facts, immutable evidence and projections; next life has fresh domain setup and cannot reuse old campaign/choice evidence."
  },
  {
    "table": "resource_pools",
    "scope": "SCOPED",
    "fields": {
      "scope_id": "OWNER",
      "resource_key": "OWNER",
      "amount": "OWNER",
      "capacity": "OWNER"
    },
    "reason": "Run pools archive; fresh run/build computes new pools; independent owners persist."
  },
  {
    "table": "run_attribute_choices",
    "scope": "RUN",
    "fields": {
      "id": "ARCHIVE",
      "run_id": "ARCHIVE",
      "action_id": "ARCHIVE",
      "choice_no": "ARCHIVE",
      "rules_id": "ARCHIVE",
      "rules_kind": "ARCHIVE",
      "rules_revision": "ARCHIVE",
      "release_id": "ARCHIVE",
      "milestone": "ARCHIVE",
      "level_at_choice": "ARCHIVE",
      "build_event_id": "ARCHIVE",
      "allocation": "ARCHIVE",
      "before_attributes": "ARCHIVE",
      "after_attributes": "ARCHIVE",
      "created_at": "ARCHIVE"
    },
    "reason": "Retain old-run facts, immutable evidence and projections; next life has fresh domain setup and cannot reuse old campaign/choice evidence."
  },
  {
    "table": "run_build_events",
    "scope": "RUN",
    "fields": {
      "id": "ARCHIVE",
      "run_id": "ARCHIVE",
      "revision": "ARCHIVE",
      "action_id": "ARCHIVE",
      "kind": "ARCHIVE",
      "class_id": "ARCHIVE",
      "class_kind": "ARCHIVE",
      "class_revision": "ARCHIVE",
      "release_id": "ARCHIVE",
      "rules_id": "ARCHIVE",
      "rules_kind": "ARCHIVE",
      "rules_revision": "ARCHIVE",
      "curve_id": "ARCHIVE",
      "curve_kind": "ARCHIVE",
      "curve_revision": "ARCHIVE",
      "preset_key": "ARCHIVE",
      "xp_at_choice": "ARCHIVE",
      "before_state": "ARCHIVE",
      "after_state": "ARCHIVE",
      "created_at": "ARCHIVE"
    },
    "reason": "Retain old-run facts, immutable evidence and projections; next life has fresh domain setup and cannot reuse old campaign/choice evidence."
  },
  {
    "table": "run_builds",
    "scope": "RUN",
    "fields": {
      "run_id": "ARCHIVE",
      "revision": "ARCHIVE",
      "state": "ARCHIVE",
      "last_event_id": "ARCHIVE"
    },
    "reason": "Retain old-run facts, immutable evidence and projections; next life has fresh domain setup and cannot reuse old campaign/choice evidence."
  },
  {
    "table": "run_class_levels",
    "scope": "RUN",
    "fields": {
      "run_id": "ARCHIVE",
      "class_id": "ARCHIVE",
      "definition_kind": "ARCHIVE",
      "native_level": "ARCHIVE"
    },
    "reason": "Retain old-run facts, immutable evidence and projections; next life has fresh domain setup and cannot reuse old campaign/choice evidence."
  },
  {
    "table": "run_completions",
    "scope": "RUN",
    "fields": {
      "run_id": "ARCHIVE",
      "release_id": "ARCHIVE",
      "campaign_id": "ARCHIVE",
      "definition_kind": "ARCHIVE",
      "definition_revision": "ARCHIVE",
      "final_instance_id": "ARCHIVE",
      "action_id": "ARCHIVE",
      "completed_at": "ARCHIVE",
      "ruleset": "ARCHIVE"
    },
    "reason": "Retain old-run facts, immutable evidence and projections; next life has fresh domain setup and cannot reuse old campaign/choice evidence."
  },
  {
    "table": "run_consumption",
    "scope": "RUN",
    "fields": {
      "run_id": "CARRY",
      "fullness": "CARRY",
      "drunkenness": "CARRY",
      "tolerance": "CARRY"
    },
    "reason": "Copy daily consumption exactly; rollover alone clears it."
  },
  {
    "table": "run_equipment",
    "scope": "RUN",
    "fields": {
      "run_id": "ARCHIVE",
      "active_set": "ARCHIVE",
      "revision": "ARCHIVE",
      "last_event_id": "ARCHIVE"
    },
    "reason": "Retain old-run facts, immutable evidence and projections; next life has fresh domain setup and cannot reuse old campaign/choice evidence."
  },
  {
    "table": "run_feat_choices",
    "scope": "RUN",
    "fields": {
      "id": "ARCHIVE",
      "run_id": "ARCHIVE",
      "action_id": "ARCHIVE",
      "choice_no": "ARCHIVE",
      "feat_id": "ARCHIVE",
      "feat_kind": "ARCHIVE",
      "feat_revision": "ARCHIVE",
      "rules_id": "ARCHIVE",
      "rules_kind": "ARCHIVE",
      "rules_revision": "ARCHIVE",
      "release_id": "ARCHIVE",
      "milestone": "ARCHIVE",
      "level_at_choice": "ARCHIVE",
      "build_event_id": "ARCHIVE",
      "created_at": "ARCHIVE",
      "proficiency_evidence": "ARCHIVE"
    },
    "reason": "Retain old-run facts, immutable evidence and projections; next life has fresh domain setup and cannot reuse old campaign/choice evidence."
  },
  {
    "table": "run_feats",
    "scope": "RUN",
    "fields": {
      "run_id": "ARCHIVE",
      "feat_id": "ARCHIVE",
      "feat_revision": "ARCHIVE",
      "milestone": "ARCHIVE",
      "choice_id": "ARCHIVE"
    },
    "reason": "Retain old-run facts, immutable evidence and projections; next life has fresh domain setup and cannot reuse old campaign/choice evidence."
  },
  {
    "table": "run_history",
    "scope": "RUN",
    "fields": {
      "run_id": "ARCHIVE",
      "character_id": "ARCHIVE",
      "next_run_id": "ARCHIVE",
      "action_id": "ARCHIVE",
      "summary": "ARCHIVE",
      "created_at": "ARCHIVE"
    },
    "reason": "Retain old-run facts, immutable evidence and projections; next life has fresh domain setup and cannot reuse old campaign/choice evidence."
  },
  {
    "table": "run_proficiency_choices",
    "scope": "RUN",
    "fields": {
      "id": "ARCHIVE",
      "run_id": "ARCHIVE",
      "action_id": "ARCHIVE",
      "choice_no": "ARCHIVE",
      "skill_id": "ARCHIVE",
      "skill_kind": "ARCHIVE",
      "skill_revision": "ARCHIVE",
      "rules_id": "ARCHIVE",
      "rules_kind": "ARCHIVE",
      "rules_revision": "ARCHIVE",
      "release_id": "ARCHIVE",
      "milestone": "ARCHIVE",
      "level_at_choice": "ARCHIVE",
      "build_event_id": "ARCHIVE",
      "before_rank": "ARCHIVE",
      "after_rank": "ARCHIVE",
      "created_at": "ARCHIVE"
    },
    "reason": "Retain old-run facts, immutable evidence and projections; next life has fresh domain setup and cannot reuse old campaign/choice evidence."
  },
  {
    "table": "run_progression",
    "scope": "RUN",
    "fields": {
      "run_id": "RESET",
      "level": "RESET",
      "xp": "RESET",
      "strength": "RESET",
      "dexterity": "RESET",
      "constitution": "RESET",
      "intelligence": "RESET",
      "wisdom": "RESET",
      "charisma": "RESET",
      "world_time": "RESET",
      "luck": "RESET"
    },
    "reason": "New-run defaults and fresh class/earned-choice projections; old rows retained."
  },
  {
    "table": "run_rollovers",
    "scope": "RUN",
    "fields": {
      "run_id": "ARCHIVE",
      "account_id": "ARCHIVE",
      "epoch": "ARCHIVE",
      "turn_grant": "ARCHIVE",
      "applied_at": "ARCHIVE"
    },
    "reason": "Retain old-run facts, immutable evidence and projections; next life has fresh domain setup and cannot reuse old campaign/choice evidence."
  },
  {
    "table": "run_skill_ranks",
    "scope": "RUN",
    "fields": {
      "run_id": "ARCHIVE",
      "skill_id": "ARCHIVE",
      "skill_revision": "ARCHIVE",
      "rank": "ARCHIVE",
      "last_choice_id": "ARCHIVE"
    },
    "reason": "Retain old-run facts, immutable evidence and projections; next life has fresh domain setup and cannot reuse old campaign/choice evidence."
  },
  {
    "table": "run_subclass_choices",
    "scope": "RUN",
    "fields": {
      "id": "ARCHIVE",
      "run_id": "ARCHIVE",
      "action_id": "ARCHIVE",
      "class_id": "ARCHIVE",
      "class_kind": "ARCHIVE",
      "class_revision": "ARCHIVE",
      "subclass_id": "ARCHIVE",
      "subclass_kind": "ARCHIVE",
      "subclass_revision": "ARCHIVE",
      "release_id": "ARCHIVE",
      "native_level_at_choice": "ARCHIVE",
      "build_event_id": "ARCHIVE",
      "created_at": "ARCHIVE"
    },
    "reason": "Retain old-run facts, immutable evidence and projections; next life has fresh domain setup and cannot reuse old campaign/choice evidence."
  },
  {
    "table": "run_subclasses",
    "scope": "RUN",
    "fields": {
      "run_id": "ARCHIVE",
      "class_id": "ARCHIVE",
      "subclass_id": "ARCHIVE",
      "subclass_revision": "ARCHIVE",
      "choice_id": "ARCHIVE"
    },
    "reason": "Retain old-run facts, immutable evidence and projections; next life has fresh domain setup and cannot reuse old campaign/choice evidence."
  },
  {
    "table": "run_xp_awards",
    "scope": "RUN",
    "fields": {
      "instance_id": "ARCHIVE",
      "run_id": "ARCHIVE",
      "action_id": "ARCHIVE",
      "amount": "ARCHIVE",
      "created_at": "ARCHIVE"
    },
    "reason": "Retain old-run facts, immutable evidence and projections; next life has fresh domain setup and cannot reuse old campaign/choice evidence."
  },
  {
    "table": "run_xp_baselines",
    "scope": "RUN",
    "fields": {
      "run_id": "ARCHIVE",
      "xp": "ARCHIVE",
      "origin": "ARCHIVE",
      "created_at": "ARCHIVE"
    },
    "reason": "Retain old-run facts, immutable evidence and projections; next life has fresh domain setup and cannot reuse old campaign/choice evidence."
  },
  {
    "table": "runs",
    "scope": "RUN",
    "fields": {
      "id": "RESET",
      "character_id": "CARRY",
      "turns": "CARRY",
      "revision": "RESET",
      "status": "RESET",
      "rules_version": "CARRY",
      "content_release_id": "CARRY",
      "started_at": "RESET",
      "completed_at": "RESET",
      "mode": "CARRY",
      "rules_manifest": "CARRY",
      "completion_policy": "CARRY"
    },
    "reason": "Old run archived; next identity/revision/timestamps reset; Turns, character, mode and sealed rules pin carry."
  },
  {
    "table": "scoped_state",
    "scope": "SCOPED",
    "fields": {
      "scope_id": "DECLARED",
      "scope_kind": "DECLARED",
      "key": "DECLARED",
      "value": "DECLARED",
      "revision": "DECLARED"
    },
    "reason": "KEEP independent owners; RUN CARRY/RESET/ARCHIVE; INSTANCE freezes at terminal lifecycle."
  },
  {
    "table": "shared_tactical_members",
    "scope": "RUN",
    "fields": {
      "rest_event_id": "ARCHIVE",
      "session_id": "ARCHIVE",
      "run_id": "ARCHIVE",
      "account_id": "ARCHIVE",
      "instance_id": "ARCHIVE",
      "unit_id": "ARCHIVE",
      "seat": "ARCHIVE",
      "action_id": "ARCHIVE",
      "previous_instance_id": "ARCHIVE",
      "initial_checkpoint": "ARCHIVE"
    },
    "reason": "Retain old-run facts, immutable evidence and projections; next life has fresh domain setup and cannot reuse old campaign/choice evidence."
  },
  {
    "table": "state_contracts",
    "scope": "WORLD",
    "fields": {
      "key": "KEEP",
      "owner_module": "KEEP",
      "scope_kind": "KEEP",
      "reset_policy": "KEEP",
      "value_schema": "KEEP",
      "default_value": "KEEP",
      "ascension_policy": "KEEP"
    },
    "reason": "Immutable versioned field definitions; daily RUN contracts must use CARRY."
  },
  {
    "table": "state_scopes",
    "scope": "SCOPED",
    "fields": {
      "id": "OWNER",
      "kind": "OWNER",
      "account_id": "OWNER",
      "character_id": "OWNER",
      "run_id": "OWNER",
      "instance_id": "OWNER",
      "guild_id": "OWNER",
      "event_id": "OWNER",
      "world_id": "OWNER",
      "lifecycle": "OWNER"
    },
    "reason": "RUN/terminal INSTANCE archive; independent account/character/Guild/event/world owners persist."
  },
  {
    "table": "tactical_campaign_prerequisites",
    "scope": "RUN",
    "fields": {
      "run_id": "ARCHIVE",
      "definition_id": "ARCHIVE",
      "instance_id": "ARCHIVE",
      "finish_action_id": "ARCHIVE"
    },
    "reason": "Retain old-run facts, immutable evidence and projections; next life has fresh domain setup and cannot reuse old campaign/choice evidence."
  },
  {
    "table": "tactical_effect_carryovers",
    "scope": "RUN",
    "fields": {
      "instance_id": "ARCHIVE",
      "run_id": "ARCHIVE",
      "action_id": "ARCHIVE",
      "effects": "ARCHIVE"
    },
    "reason": "Retain old-run facts, immutable evidence and projections; next life has fresh domain setup and cannot reuse old campaign/choice evidence."
  },
  {
    "table": "tactical_encounter_origins",
    "scope": "RUN",
    "fields": {
      "rest_event_id": "ARCHIVE",
      "instance_id": "ARCHIVE",
      "run_id": "ARCHIVE",
      "previous_instance_id": "ARCHIVE",
      "spec": "ARCHIVE",
      "initial_checkpoint": "ARCHIVE"
    },
    "reason": "Retain old-run facts, immutable evidence and projections; next life has fresh domain setup and cannot reuse old campaign/choice evidence."
  },
  {
    "table": "tactical_run_state",
    "scope": "RUN",
    "fields": {
      "run_id": "ARCHIVE",
      "health": "ARCHIVE",
      "mana": "ARCHIVE",
      "last_instance_id": "ARCHIVE"
    },
    "reason": "Retain old-run facts, immutable evidence and projections; next life has fresh domain setup and cannot reuse old campaign/choice evidence."
  },
  {
    "table": "turn_ledger",
    "scope": "RUN",
    "fields": {
      "id": "ARCHIVE",
      "run_id": "ARCHIVE",
      "request_id": "ARCHIVE",
      "delta": "ARCHIVE",
      "reason": "ARCHIVE",
      "created_at": "ARCHIVE"
    },
    "reason": "Retain old-run facts, immutable evidence and projections; next life has fresh domain setup and cannot reuse old campaign/choice evidence."
  },
  {
    "table": "wallets",
    "scope": "SCOPED",
    "fields": {
      "id": "CUSTODY",
      "scope_id": "CUSTODY",
      "currency_id": "CUSTODY",
      "purpose": "CUSTODY",
      "balance": "CUSTODY"
    },
    "reason": "Transfer run Gold atomically to account wealth; old wallets/history retained; shared treasuries unaffected."
  },
  {
    "table": "world_events",
    "scope": "EVENT",
    "fields": {
      "id": "KEEP",
      "world_id": "KEEP",
      "content_release_id": "KEEP",
      "lifecycle": "KEEP",
      "starts_at": "KEEP",
      "ends_at": "KEEP"
    },
    "reason": "Independent event schedule, eligibility and claims."
  },
  {
    "table": "worlds",
    "scope": "WORLD",
    "fields": {
      "id": "KEEP",
      "name": "KEEP"
    },
    "reason": "Independent shared world lifetime."
  },
{
  "table": "shared_rules_state",
  "scope": "RUN",
  "fields": {
    "run_id": "ARCHIVE",
    "revision": "ARCHIVE",
    "state": "ARCHIVE"
  },
  "reason": "New lives start fresh; archived effects and clocks retain action provenance."
},
{
  "table": "shared_rules_events",
  "scope": "RUN",
  "fields": {
    "action_id": "ARCHIVE",
    "run_id": "ARCHIVE",
    "release_id": "ARCHIVE",
    "entity_id": "ARCHIVE",
    "entity_revision": "ARCHIVE",
    "seed": "ARCHIVE",
    "state_revision": "ARCHIVE",
    "evidence": "ARCHIVE",
    "before_state": "ARCHIVE",
    "after_state": "ARCHIVE"
  },
  "reason": "Immutable checks, costs, clock boundaries, effects and rewards retained as history."
},
{
  "table": "feature_controls",
  "scope": "WORLD",
  "fields": {
    "key": "KEEP",
    "taxonomy": "KEEP",
    "mode": "KEEP",
    "cohort_percent": "KEEP",
    "revision": "KEEP",
    "reason": "KEEP"
  },
  "reason": "Server-owned controls survive lives."
},
{
  "table": "feature_control_events",
  "scope": "WORLD",
  "fields": {
    "id": "KEEP",
    "key": "KEEP",
    "operator": "KEEP",
    "before_state": "KEEP",
    "after_state": "KEEP",
    "changed_at": "KEEP"
  },
  "reason": "Immutable operator audit history."
},
{
  "table": "release_adoptions",
  "scope": "WORLD",
  "fields": {
    "release_id": "KEEP",
    "new_runs": "KEEP",
    "compatibility": "KEEP",
    "reason": "KEEP",
    "approved_at": "KEEP"
  },
  "reason": "Reviewed new-run adoption; existing snapshots remain pinned."
}
,{
 "table":"inventory_quantity_order","scope":"ACCOUNT",
 "fields":{"operation_no":"KEEP","operation_id":"KEEP"},
 "reason":"Protected append-only ordering of physical quantity history survives lives and attests old encounter loads."
}
 ,{
 "table":"inventory_repairs","scope":"RUN",
 "fields":{"action_id":"ARCHIVE","item_id":"ARCHIVE","run_id":"ARCHIVE","wear_id":"ARCHIVE","before_condition":"ARCHIVE","after_condition":"ARCHIVE","cost":"ARCHIVE"},
 "reason":"Immutable repair/payment evidence remains attached to its source life; physical items retain repaired condition when later custody permits their use."
}
] as const;

export async function assertLifetimeFields(client:Pick<pg.PoolClient,'query'>){
 const rows=(await client.query(`SELECT c.table_name,array_agg(c.column_name::text ORDER BY c.ordinal_position) AS fields FROM information_schema.columns c JOIN information_schema.tables t ON t.table_schema=c.table_schema AND t.table_name=c.table_name AND t.table_type='BASE TABLE' WHERE c.table_schema=current_schema() AND (c.table_name=ANY($1::text[]) OR c.table_name IN(SELECT table_name FROM information_schema.columns WHERE table_schema=current_schema() AND column_name='run_id')) GROUP BY c.table_name ORDER BY c.table_name`,[lifetimeRoots])).rows;
 const expected=lifetimeFields.map(t=>({table_name:t.table,fields:Object.keys(t.fields).sort()})).sort((a,b)=>a.table_name<b.table_name?-1:1);
 const actual=rows.map(r=>({table_name:r.table_name,fields:[...r.fields].sort()}));
 if(JSON.stringify(actual)!==JSON.stringify(expected))throw new Error('Owned-state field coverage changed; review the lifetime manifest');
}
