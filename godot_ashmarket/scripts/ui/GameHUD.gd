## GameHUD — In-world heads-up display
## Shows gold, savings, XP bar, level, day, streak, and toast notifications.
## Attach to a CanvasLayer node.
class_name GameHUD
extends CanvasLayer

@onready var gold_label: Label = %GoldLabel
@onready var savings_label: Label = %SavingsLabel
@onready var xp_bar: ProgressBar = %XPBar
@onready var xp_label: Label = %XPLabel
@onready var level_label: Label = %LevelLabel
@onready var day_label: Label = %DayLabel
@onready var streak_label: Label = %StreakLabel
@onready var debt_label: Label = %DebtLabel
@onready var toast_container: VBoxContainer = %ToastContainer

const TOAST_SCENE := preload("res://scenes/ui/Toast.tscn")

func _ready() -> void:
	EventBus.gold_changed.connect(_on_gold_changed)
	EventBus.savings_changed.connect(_on_savings_changed)
	EventBus.debt_changed.connect(_on_debt_changed)
	EventBus.level_up.connect(_on_level_up)
	EventBus.day_advanced.connect(_on_day_advanced)
	EventBus.hud_notification.connect(_show_toast)
	EventBus.chapter_completed.connect(_on_chapter_completed)

	# Initialize from PlayerData (populated after WebBridge fires)
	await get_tree().create_timer(0.1).timeout
	_refresh_all()

func _refresh_all() -> void:
	_update_gold(PlayerData.gold, 0)
	_update_savings(PlayerData.savings, 0)
	_update_debt(PlayerData.debt, 0)
	_update_xp()
	_update_day(PlayerData.day)
	_update_streak(PlayerData.streak)

# ── Stat updates ──────────────────────────────────────────────────────────────

func _on_gold_changed(new_gold: int, delta: int) -> void:
	_update_gold(new_gold, delta)

func _update_gold(amount: int, delta: int) -> void:
	gold_label.text = "🪙 %d" % amount
	if delta != 0:
		_spawn_delta_label(gold_label, delta, Color(1, 0.85, 0.2) if delta > 0 else Color(1, 0.3, 0.3))

func _on_savings_changed(new_savings: int, _delta: int) -> void:
	_update_savings(new_savings, _delta)

func _update_savings(amount: int, _delta: int) -> void:
	savings_label.text = "🏦 %d" % amount

func _on_debt_changed(new_debt: int, _delta: int) -> void:
	_update_debt(new_debt, _delta)

func _update_debt(amount: int, _delta: int) -> void:
	debt_label.text = "📋 %d" % amount
	debt_label.visible = amount > 0

func _on_level_up(new_level: int) -> void:
	level_label.text = "Lv. %d" % new_level
	_show_toast("Level Up! You are now Level %d!" % new_level, "success")

func _update_xp() -> void:
	var xp_in_level := PlayerData.xp % PlayerData.XP_PER_LEVEL
	xp_bar.value = float(xp_in_level) / float(PlayerData.XP_PER_LEVEL) * 100.0
	xp_label.text = "%d / %d XP" % [xp_in_level, PlayerData.XP_PER_LEVEL]
	level_label.text = "Lv. %d" % PlayerData.level

func _on_day_advanced(new_day: int) -> void:
	_update_day(new_day)

func _update_day(day: int) -> void:
	day_label.text = "Day %d" % day

func _update_streak(streak: int) -> void:
	streak_label.text = "🔥 %d" % streak
	streak_label.visible = streak > 0

# ── Chapter completed feedback ────────────────────────────────────────────────

func _on_chapter_completed(chapter_id: String, outcome: Dictionary) -> void:
	_update_xp()
	var xp_gained: int = outcome.get("xp", 0)
	if xp_gained > 0:
		_show_toast("+%d XP" % xp_gained, "success")

# ── Toast notifications ───────────────────────────────────────────────────────

func _show_toast(message: String, type: String) -> void:
	if not toast_container:
		return
	# Fallback: simple Label if Toast scene missing
	if not ResourceLoader.exists("res://scenes/ui/Toast.tscn"):
		_show_fallback_toast(message, type)
		return
	var toast: Control = TOAST_SCENE.instantiate()
	toast_container.add_child(toast)
	if toast.has_method("show_message"):
		toast.show_message(message, type)

func _show_fallback_toast(message: String, _type: String) -> void:
	var lbl := Label.new()
	lbl.text = message
	lbl.add_theme_font_size_override("font_size", 16)
	toast_container.add_child(lbl)
	var tween := create_tween()
	tween.tween_interval(2.5)
	tween.tween_callback(lbl.queue_free)

# ── Floating delta label ──────────────────────────────────────────────────────

func _spawn_delta_label(anchor: Control, delta: int, color: Color) -> void:
	var lbl := Label.new()
	lbl.text = ("%+d" % delta)
	lbl.add_theme_color_override("font_color", color)
	lbl.add_theme_font_size_override("font_size", 18)
	lbl.position = anchor.global_position + Vector2(-10, -20)
	get_tree().current_scene.get_node("HUD").add_child(lbl)

	var tween := create_tween()
	tween.tween_property(lbl, "position:y", lbl.position.y - 40, 0.8)
	tween.parallel().tween_property(lbl, "modulate:a", 0.0, 0.8)
	tween.tween_callback(lbl.queue_free)
