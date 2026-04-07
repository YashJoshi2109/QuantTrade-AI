## EventBus — Global signal hub for decoupled communication
## Add to Autoload as "EventBus"
extends Node

# ── Player signals ────────────────────────────────────────────────────────────
signal player_moved(new_position: Vector3)
signal player_near_building(building_id: String)
signal player_left_building(building_id: String)

# ── Building / interaction signals ───────────────────────────────────────────
signal building_clicked(building_id: String, building_data: Dictionary)
signal building_interaction_started(building_id: String)
signal building_interaction_ended(building_id: String)

# ── Dialogue signals ─────────────────────────────────────────────────────────
signal dialogue_started(chapter_id: String, npc_name: String)
signal dialogue_choice_made(choice_id: String, choice_data: Dictionary)
signal dialogue_ended(chapter_id: String, outcome: Dictionary)

# ── Economy signals ───────────────────────────────────────────────────────────
signal gold_changed(new_gold: int, delta: int)
signal savings_changed(new_savings: int, delta: int)
signal xp_gained(amount: int, new_total: int)
signal level_up(new_level: int)
signal debt_changed(new_debt: int, delta: int)

# ── Chapter / quest signals ───────────────────────────────────────────────────
signal chapter_unlocked(chapter_id: String)
signal chapter_started(chapter_id: String)
signal chapter_completed(chapter_id: String, outcome: Dictionary)
signal day_advanced(new_day: int)

# ── UI signals ────────────────────────────────────────────────────────────────
signal hud_notification(message: String, type: String)  # type: info|success|warning|error
signal camera_shake_requested(intensity: float, duration: float)
signal coin_burst_requested(position: Vector3, amount: int)

# ── Web bridge signals ────────────────────────────────────────────────────────
signal web_data_received(data: Dictionary)
signal web_data_send_requested(event: String, data: Dictionary)
