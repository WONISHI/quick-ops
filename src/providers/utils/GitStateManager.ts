export class GitStateManager {
  private _isRefreshing = false;
  private _pendingRefresh: { cwd: string; fullRefresh: boolean } | null = null;

  private _debounceTimer: NodeJS.Timeout | null = null;
  private _lastGraphState = '';

  private _isRemoteSyncChecking = false;

  isRefreshing(): boolean {
    return this._isRefreshing;
  }

  setRefreshing(value: boolean) {
    this._isRefreshing = value;
  }

  getPendingRefresh() {
    return this._pendingRefresh;
  }

  setPendingRefresh(value: { cwd: string; fullRefresh: boolean } | null) {
    this._pendingRefresh = value;
  }

  getDebounceTimer() {
    return this._debounceTimer;
  }

  setDebounceTimer(timer: NodeJS.Timeout | null) {
    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer);
    }
    this._debounceTimer = timer;
  }

  getLastGraphState(): string {
    return this._lastGraphState;
  }

  setLastGraphState(state: string) {
    this._lastGraphState = state;
  }

  isRemoteSyncChecking(): boolean {
    return this._isRemoteSyncChecking;
  }

  setRemoteSyncChecking(value: boolean) {
    this._isRemoteSyncChecking = value;
  }

  clearDebounceTimer() {
    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer);
      this._debounceTimer = null;
    }
  }

  destroy() {
    this.clearDebounceTimer();
    this._isRefreshing = false;
    this._pendingRefresh = null;
    this._isRemoteSyncChecking = false;
  }
}
