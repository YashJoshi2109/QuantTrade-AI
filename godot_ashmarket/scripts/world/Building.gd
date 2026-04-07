## Building — Interactive building base class
## Attach to each StaticBody3D building node in the scene.
## Emits building_clicked via EventBus when player interacts.
class_name Building
extends StaticBody3D

@export var building_id: String = ""
@export var building_label: String = ""
@export_range(1.5, 8.0) var interact_radius: float = 3.0

@onready var interaction_area: Area3D = $InteractionArea
@onready var label_3d: Label3D = $Label3D
@onready var highlight_mesh: MeshInstance3D = $HighlightMesh

var _player_nearby: bool = false
var _is_highlighted: bool = false

# Tween for pulse effect
var _pulse_tween: Tween = null

func _ready() -> void:
	if label_3d:
		label_3d.text = building_label

	if interaction_area:
		interaction_area.body_entered.connect(_on_body_entered)
		interaction_area.body_exited.connect(_on_body_exited)

	if highlight_mesh:
		highlight_mesh.visible = false

	# Click detection via InputEvent on StaticBody3D requires input_ray_pickable
	input_ray_pickable = true

func _input_event(_camera: Camera3D, event: InputEvent, _pos: Vector3, _normal: Vector3, _shape: int) -> void:
	if event is InputEventMouseButton and event.button_index == MOUSE_BUTTON_LEFT and event.pressed:
		_on_clicked()

func _on_clicked() -> void:
	var data := {
		"label": building_label,
		"player_nearby": _player_nearby,
	}
	EventBus.building_clicked.emit(building_id, data)
	_flash_highlight()

func _on_body_entered(body: Node3D) -> void:
	if body.is_in_group("player"):
		_player_nearby = true
		EventBus.player_near_building.emit(building_id)
		_set_highlight(true)

func _on_body_exited(body: Node3D) -> void:
	if body.is_in_group("player"):
		_player_nearby = false
		EventBus.player_left_building.emit(building_id)
		_set_highlight(false)

func _set_highlight(on: bool) -> void:
	_is_highlighted = on
	if highlight_mesh:
		highlight_mesh.visible = on

func _flash_highlight() -> void:
	if not highlight_mesh:
		return
	if _pulse_tween:
		_pulse_tween.kill()
	highlight_mesh.visible = true
	_pulse_tween = create_tween()
	_pulse_tween.tween_property(highlight_mesh, "transparency", 0.0, 0.1)
	_pulse_tween.tween_property(highlight_mesh, "transparency", 0.8, 0.2)
	_pulse_tween.tween_property(highlight_mesh, "transparency", 0.0, 0.1)
	_pulse_tween.tween_callback(func(): highlight_mesh.visible = _is_highlighted)
