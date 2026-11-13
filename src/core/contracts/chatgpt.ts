export interface ChatGPTStatus {
	available: boolean;
	pending: boolean;
	allowBackgroundUse: boolean;
	activeId: string | null;
	accounts: {
		id: string; email: string; registration: string; connected: boolean; planEnabled?: boolean;
		canSignInAgain?: boolean;
	}[];
	error: string | null;
	catalogError?: string | null;
}
export interface ChatGPTControlBridge {
	status(): Promise<ChatGPTStatus>;
	login(id?: string): Promise<ChatGPTStatus>;
	cancel(): Promise<ChatGPTStatus>;
	select(id: string): Promise<ChatGPTStatus>;
	disconnect(id: string): Promise<ChatGPTStatus>;
	logout(id: string): Promise<ChatGPTStatus>;
	consent(enabled: boolean): Promise<ChatGPTStatus>;
	onChange(callback: () => void): () => void;
}
