## PlayerData — Persistent game state (mirrors QuantTrade backend wallet)
## Autoload singleton. Syncs with Next.js backend via WebBridge.
extends Node

# ── Core stats ────────────────────────────────────────────────────────────────
var gold: int = 50:
	set(value):
		var delta := value - gold
		gold = max(0, value)
		EventBus.gold_changed.emit(gold, delta)

var savings: int = 0:
	set(value):
		var delta := value - savings
		savings = max(0, value)
		EventBus.savings_changed.emit(savings, delta)

var emergency_fund: int = 0
var debt: int = 0:
	set(value):
		var delta := value - debt
		debt = max(0, value)
		EventBus.debt_changed.emit(debt, delta)

var xp: int = 0:
	set(value):
		xp = value
		_check_level_up()

var level: int = 1
var day: int = 1
var streak: int = 0

# ── Chapter progress ─────────────────────────────────────────────────────────
var completed_chapters: Array[String] = []
var active_chapter: String = ""
var current_goal_label: String = "Roof Fund"
var current_goal_saved: int = 0
var current_goal_target: int = 100

# ── Player identity ───────────────────────────────────────────────────────────
var character_name: String = "Apprentice"
var avatar_style: String = "scholar"

# ── XP thresholds ─────────────────────────────────────────────────────────────
const XP_PER_LEVEL: int = 200

func _check_level_up() -> void:
	var new_level := 1 + int(xp / XP_PER_LEVEL)
	if new_level > level:
		level = new_level
		EventBus.level_up.emit(level)
		EventBus.hud_notification.emit("Level Up! You are now Level %d!" % level, "success")

func net_worth() -> int:
	return gold + savings + emergency_fund - debt

# ── Load from web data ────────────────────────────────────────────────────────
func load_from_web(data: Dictionary) -> void:
	gold = data.get("gold", 50)
	savings = data.get("savings", 0)
	emergency_fund = data.get("emergency", 0)
	debt = data.get("debt", 0)
	xp = data.get("xp", 0)
	level = data.get("level", 1)
	day = data.get("day_number", 1)
	streak = data.get("streak", 0)
	character_name = data.get("character_name", "Apprentice")
	avatar_style = data.get("avatar_style", "scholar")
	current_goal_label = data.get("goal_label", "Roof Fund")
	current_goal_saved = data.get("goal_saved", 0)
	current_goal_target = data.get("goal_target", 100)

	var raw_chapters: Array = data.get("completed_chapters", [])
	completed_chapters.clear()
	for ch in raw_chapters:
		completed_chapters.append(str(ch))

# ── Serialize for web sync ────────────────────────────────────────────────────
func to_dict() -> Dictionary:
	return {
		"gold": gold,
		"savings": savings,
		"emergency": emergency_fund,
		"debt": debt,
		"xp": xp,
		"level": level,
		"day_number": day,
		"streak": streak,
		"completed_chapters": completed_chapters,
	}

# ── Apply chapter outcome ─────────────────────────────────────────────────────
func apply_choice_outcome(outcome: Dictionary) -> void:
	gold += outcome.get("gold_delta", 0)
	savings += outcome.get("savings_delta", 0)
	emergency_fund += outcome.get("emergency_delta", 0)
	debt += outcome.get("debt_delta", 0)
	xp += outcome.get("xp_reward", 0)

func complete_chapter(chapter_id: String) -> void:
	if chapter_id not in completed_chapters:
		completed_chapters.append(chapter_id)
	active_chapter = ""
	day += 1
	EventBus.day_advanced.emit(day)
