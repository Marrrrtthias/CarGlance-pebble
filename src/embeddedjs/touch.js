// Touch helpers shared by the windows.

// Whether the global point x, y is inside the content.
export function inside(content, x, y) {
	return x >= content.x && x < content.x + content.width && y >= content.y && y < content.y + content.height;
}

// A tap target: the action runs when a touch starts and ends inside the
// content. The content must be active; its data is the action.
//   new Container(action, { active: true, Behavior: TapBehavior, ... })
export class TapBehavior extends Behavior {
	onCreate(content, action) {
		this.action = action;
	}
	onTouchBegan(content, id, x, y) {
		this.began = inside(content, x, y);
	}
	onTouchEnded(content, id, x, y) {
		const began = this.began;
		this.began = false;
		if (began && inside(content, x, y))
			this.action();
	}
}
