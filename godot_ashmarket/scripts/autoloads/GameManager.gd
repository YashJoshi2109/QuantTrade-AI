## GameManager — Top-level game controller
## Autoload singleton. Manages game states, loading, scene transitions.
extends Node

enum GameState {
	LOADING,
	WORLD_EXPLORE,
	DIALOGUE,
	CHAPTER_ACTIVE,
	REFLECTION,
	PAUSED,
}

var current_state: GameState = GameState.LOADING
var _previous_state: GameState = GameState.LOADING

# ── Chapter data (mirrors student-chapters.ts) ───────────────────────────────
const CHAPTER_DATA: Dictionary = {
	"ch1": {
		"id": "ch1", "num": 1, "title": "Your First Coin",
		"building": "market_stall", "npc": "Mira",
		"npc_dialogue": "Congratulations on your first sale! You've earned 22 silver. What will you do with it?",
		"choices": [
			{"id": "save_all", "label": "Save all 22s in the roof fund", "gold_delta": 0, "savings_delta": 22, "xp": 60, "optimal": true},
			{"id": "spend_half", "label": "Spend 10, save 12", "gold_delta": -10, "savings_delta": 12, "xp": 40, "optimal": false},
			{"id": "spend_all", "label": "Treat yourself — spend it all", "gold_delta": 0, "savings_delta": 0, "xp": 20, "optimal": false},
		]
	},
	"ch2": {
		"id": "ch2", "num": 2, "title": "The Spending Trap",
		"building": "market_stall", "npc": "Mira",
		"npc_dialogue": "There is a beautiful new cloak for 35 silver. You have 50s. It's tempting…",
		"choices": [
			{"id": "skip_cloak", "label": "Skip it, save instead", "gold_delta": 0, "savings_delta": 15, "xp": 65, "optimal": true},
			{"id": "buy_cloak", "label": "Buy the cloak", "gold_delta": -35, "savings_delta": 0, "xp": 25, "optimal": false},
			{"id": "haggle", "label": "Haggle for a lower price (28s)", "gold_delta": -28, "savings_delta": 0, "xp": 45, "optimal": false},
		]
	},
	"ch3": {
		"id": "ch3", "num": 3, "title": "Market Day",
		"building": "trade_caravan", "npc": "Rafiq",
		"npc_dialogue": "Market day! You can sell at the busy Grand Market or the quiet side lane. Choose wisely.",
		"choices": [
			{"id": "grand_market", "label": "Grand Market — busy but costly", "gold_delta": 18, "savings_delta": 0, "xp": 50, "optimal": true},
			{"id": "side_lane", "label": "Side lane — safe but lower profit", "gold_delta": 10, "savings_delta": 0, "xp": 35, "optimal": false},
		]
	},
	"ch4": {
		"id": "ch4", "num": 4, "title": "The Debt Trap",
		"building": "guild_hall", "npc": "Elder Sera",
		"npc_dialogue": "Your cart breaks down. Repairs cost 30 silver. You only have 15. Two lenders approach you.",
		"choices": [
			{"id": "no_loan", "label": "Refuse all loans, work extra shifts", "gold_delta": 0, "savings_delta": 0, "xp": 60, "optimal": true},
			{"id": "guild_loan", "label": "Guild Fair Loan — 10% interest, 30 days", "gold_delta": 30, "savings_delta": 0, "debt_delta": 33, "xp": 40, "optimal": false},
			{"id": "street_loan", "label": "Street Loan — 50% interest, 7 days", "gold_delta": 30, "savings_delta": 0, "debt_delta": 45, "xp": 15, "optimal": false},
		]
	},
	"ch5": {
		"id": "ch5", "num": 5, "title": "Emergency Reserves",
		"building": "treasury", "npc": "Banker Colm",
		"npc_dialogue": "Illness strikes. You need 20 silver for medicine. Do you have an emergency reserve?",
		"choices": [
			{"id": "use_emergency", "label": "Use emergency reserve", "emergency_delta": -20, "xp": 70, "optimal": true},
			{"id": "borrow", "label": "Borrow from a friend", "debt_delta": 20, "xp": 35, "optimal": false},
			{"id": "skip_medicine", "label": "Skip medicine, rest it out", "gold_delta": -10, "xp": 20, "optimal": false},
		]
	},
	"ch6": {
		"id": "ch6", "num": 6, "title": "The Investment Crossroads",
		"building": "trade_caravan", "npc": "Rafiq",
		"npc_dialogue": "Rafiq's Caravan Trade Guild offers a 15% return in 60 days. You have 40 silver spare.",
		"choices": [
			{"id": "invest_half", "label": "Invest 20s, keep 20s liquid", "gold_delta": -20, "savings_delta": 23, "xp": 65, "optimal": true},
			{"id": "invest_all", "label": "Invest all 40s", "gold_delta": -40, "savings_delta": 46, "xp": 50, "optimal": false},
			{"id": "no_invest", "label": "Keep all in pocket", "xp": 30, "optimal": false},
		]
	},
	"ch7": {
		"id": "ch7", "num": 7, "title": "Trust and Scams",
		"building": "home", "npc": "Neighbor Bess",
		"npc_dialogue": "A stranger knocks. 'Double your gold in 3 days!' They want 30 silver upfront.",
		"choices": [
			{"id": "refuse", "label": "Refuse — too good to be true", "xp": 75, "optimal": true},
			{"id": "investigate", "label": "Ask for references first", "xp": 55, "optimal": false},
			{"id": "trust", "label": "Pay the 30 silver", "gold_delta": -30, "xp": 10, "optimal": false},
		]
	},
	"ch8": {
		"id": "ch8", "num": 8, "title": "The Savings Goal",
		"building": "treasury", "npc": "Banker Colm",
		"npc_dialogue": "You're 40 silver from your roof repair goal. Winter is coming in 30 days.",
		"choices": [
			{"id": "strict_save", "label": "Cut all non-essential spending for 30 days", "savings_delta": 40, "xp": 80, "optimal": true},
			{"id": "moderate_save", "label": "Save 25s, keep some for comfort", "savings_delta": 25, "xp": 55, "optimal": false},
			{"id": "ignore_goal", "label": "Worry about it later", "xp": 15, "optimal": false},
		]
	},
	"ch9": {
		"id": "ch9", "num": 9, "title": "Guild Membership",
		"building": "guild_hall", "npc": "Elder Sera",
		"npc_dialogue": "The Merchant's Guild offers membership for 15 silver. Benefits: better prices, loans, community support.",
		"choices": [
			{"id": "join_guild", "label": "Join the Guild", "gold_delta": -15, "savings_delta": 8, "xp": 70, "optimal": true},
			{"id": "negotiate", "label": "Negotiate a trial membership", "gold_delta": -5, "xp": 60, "optimal": false},
			{"id": "skip_guild", "label": "Save the 15 silver", "savings_delta": 15, "xp": 40, "optimal": false},
		]
	},
	"ch10": {
		"id": "ch10", "num": 10, "title": "The Roof is Fixed",
		"building": "home", "npc": "Neighbor Bess",
		"npc_dialogue": "You did it! Your roof is fixed. Look at how far you've come. What's next?",
		"choices": [
			{"id": "new_goal", "label": "Set a new savings goal immediately", "savings_delta": 10, "xp": 100, "optimal": true},
			{"id": "celebrate", "label": "Celebrate — spend 20s on a feast", "gold_delta": -20, "xp": 50, "optimal": false},
			{"id": "rest", "label": "Take a month off from saving", "xp": 30, "optimal": false},
		]
	},
}

func _ready() -> void:
	EventBus.building_clicked.connect(_on_building_clicked)
	EventBus.dialogue_choice_made.connect(_on_choice_made)
	EventBus.web_data_received.connect(_on_web_data)

func change_state(new_state: GameState) -> void:
	if new_state == current_state:
		return
	_previous_state = current_state
	current_state = new_state

func restore_state() -> void:
	current_state = _previous_state

func get_chapter(chapter_id: String) -> Dictionary:
	return CHAPTER_DATA.get(chapter_id, {})

func is_chapter_available(chapter_id: String) -> bool:
	if chapter_id in PlayerData.completed_chapters:
		return false
	# ch1 always available; subsequent chapters unlock after previous
	var keys: Array = CHAPTER_DATA.keys()
	var idx := keys.find(chapter_id)
	if idx <= 0:
		return true
	var prev_id: String = keys[idx - 1]
	return prev_id in PlayerData.completed_chapters

func _on_building_clicked(building_id: String, _data: Dictionary) -> void:
	if current_state == GameState.DIALOGUE or current_state == GameState.CHAPTER_ACTIVE:
		return
	# Find chapters assigned to this building
	for ch_id in CHAPTER_DATA:
		var ch: Dictionary = CHAPTER_DATA[ch_id]
		if ch.get("building") == building_id and is_chapter_available(ch_id):
			change_state(GameState.CHAPTER_ACTIVE)
			PlayerData.active_chapter = ch_id
			EventBus.chapter_started.emit(ch_id)
			return

func _on_choice_made(choice_id: String, choice_data: Dictionary) -> void:
	var chapter_id := PlayerData.active_chapter
	if chapter_id.is_empty():
		return

	PlayerData.apply_choice_outcome(choice_data)
	PlayerData.complete_chapter(chapter_id)

	var outcome := {
		"chapter_id": chapter_id,
		"choice_id": choice_id,
		"gold": PlayerData.gold,
		"savings": PlayerData.savings,
		"xp": PlayerData.xp,
	}
	EventBus.chapter_completed.emit(chapter_id, outcome)
	change_state(GameState.REFLECTION)

	# Sync back to web
	EventBus.web_data_send_requested.emit("chapter_complete", PlayerData.to_dict())

func _on_web_data(data: Dictionary) -> void:
	PlayerData.load_from_web(data)
