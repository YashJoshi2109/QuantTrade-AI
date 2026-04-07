## DialogueBox — NPC chapter dialogue and choice UI
## Attach to a CanvasLayer > Control node in the scene.
class_name DialogueBox
extends Control

@onready var panel: PanelContainer = $Panel
@onready var npc_name_label: Label = $Panel/VBox/Header/NPCName
@onready var portrait: TextureRect = $Panel/VBox/Header/Portrait
@onready var dialogue_label: RichTextLabel = $Panel/VBox/DialogueText
@onready var choices_container: VBoxContainer = $Panel/VBox/Choices
@onready var type_timer: Timer = $TypeTimer

const CHOICE_BUTTON_SCENE := preload("res://scenes/ui/ChoiceButton.tscn")
const TYPE_SPEED := 0.03  # seconds per character

var _full_text: String = ""
var _char_index: int = 0
var _current_chapter_id: String = ""
var _choices: Array = []
var _typing: bool = false

func _ready() -> void:
	hide()
	EventBus.chapter_started.connect(_on_chapter_started)
	EventBus.chapter_completed.connect(_on_chapter_completed)

	type_timer.wait_time = TYPE_SPEED
	type_timer.timeout.connect(_on_type_tick)

func _on_chapter_started(chapter_id: String) -> void:
	var ch: Dictionary = GameManager.get_chapter(chapter_id)
	if ch.is_empty():
		return
	_current_chapter_id = chapter_id
	_choices = ch.get("choices", [])

	npc_name_label.text = ch.get("npc", "NPC")
	_full_text = ch.get("npc_dialogue", "")

	_clear_choices()
	dialogue_label.text = ""
	_char_index = 0
	_typing = true

	# Load portrait texture if available
	var portrait_path := "res://assets/portraits/%s.png" % ch.get("npc", "npc").to_lower().replace(" ", "_")
	if ResourceLoader.exists(portrait_path):
		portrait.texture = load(portrait_path)

	show()
	GameManager.change_state(GameManager.GameState.DIALOGUE)
	EventBus.dialogue_started.emit(chapter_id, ch.get("npc", ""))
	type_timer.start()

func _on_type_tick() -> void:
	if _char_index < _full_text.length():
		_char_index += 1
		dialogue_label.text = _full_text.left(_char_index)
	else:
		type_timer.stop()
		_typing = false
		_show_choices()

func _input(event: InputEvent) -> void:
	if not visible:
		return
	# Skip typewriter on click/space
	if event.is_action_pressed("interact") or \
	   (event is InputEventMouseButton and event.button_index == MOUSE_BUTTON_LEFT and event.pressed):
		if _typing:
			type_timer.stop()
			_typing = false
			dialogue_label.text = _full_text
			_show_choices()

func _show_choices() -> void:
	_clear_choices()
	for choice in _choices:
		var btn: Button = _make_choice_button(choice)
		choices_container.add_child(btn)

func _make_choice_button(choice: Dictionary) -> Button:
	var btn := Button.new()
	btn.text = choice.get("label", "")
	btn.custom_minimum_size = Vector2(0, 48)
	btn.alignment = HORIZONTAL_ALIGNMENT_LEFT
	# Style optimal choice differently
	if choice.get("optimal", false):
		btn.add_theme_color_override("font_color", Color(0.2, 0.9, 0.4))
	btn.pressed.connect(func(): _on_choice_pressed(choice))
	return btn

func _on_choice_pressed(choice: Dictionary) -> void:
	_clear_choices()
	hide()
	EventBus.dialogue_choice_made.emit(choice.get("id", ""), choice)

func _on_chapter_completed(_chapter_id: String, _outcome: Dictionary) -> void:
	# Dialogue box hides itself; reflection state handled by GameManager
	pass

func _clear_choices() -> void:
	for child in choices_container.get_children():
		child.queue_free()
