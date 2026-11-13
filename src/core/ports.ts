
import type {
ChatRecord,
ChatSettings,
ChatSummary,
CoverageEntry,
ExtractionRunUsage,
GraphChain,
GraphNode,
ImageSnapshot,
JobKind,
JobRecord,
NotesSource,
PlanTree,
PluginJobMetadata,
Position,
SessionCheckpoint,
SideChatThread,
TurnUsage,
} from "./contracts.ts";
import type { OwllyMessage } from "./native-messages.ts";
import type { UserSettings } from "./settings.ts";


export interface ChatStore {
	createChat(title: string, kind?: "practice"): ChatRecord;
	getChat(id: string): ChatRecord | null;
	listChats(): ChatSummary[];
	saveMessages(id: string, messages: OwllyMessage[]): void;
	saveImageSnapshot(id: string, snapshotId: string, image: ImageSnapshot): void;
	saveTree(id: string, tree: PlanTree): void;
	appendTurnUsage(id: string, entry: TurnUsage): void;
	appendExtractionUsage(id: string, entry: ExtractionRunUsage): void;
	saveSettings(id: string, settings: ChatSettings): void;
	renameChat(id: string, title: string): ChatRecord;
	deleteChat(id: string): boolean;
	updateSideChats(id: string, update: (threads: SideChatThread[]) => SideChatThread[]): SideChatThread[] | null;
}


export interface GraphStore {
	appendNode(node: GraphNode): void;
	readNodes(): GraphNode[];

	appendChain(assertion: GraphChain): void;
	readChains(): GraphChain[];

	appendCheckpoint(checkpoint: SessionCheckpoint): void;
	readCheckpoints(): SessionCheckpoint[];
	appendCoverage(entry: CoverageEntry): void;
	readCoverage(): CoverageEntry[];


	upsertSource(source: NotesSource): void;
	readSources(): NotesSource[];
	deleteSources(ids: ReadonlySet<string>): number;
	appendSourceUsage(id: string, entry: ExtractionRunUsage): void;

	readPositions(): Record<string, Position>;
	writePositions(positions: Record<string, Position>): void;

	rewriteLedgers(next: {
		nodes?: GraphNode[];
		chains?: GraphChain[];
		coverage?: CoverageEntry[];
		checkpoints?: SessionCheckpoint[];
	}): void;
}

export interface SourceOrganizationStore {
	read(): import("./source-organization.ts").SourceOrganization;
	write(state: import("./source-organization.ts").SourceOrganization): void;
}


export interface CreateJobInit {
	kind: JobKind;
	chatId: string;
	toolCallId: string;
	activity?: string;
	plugin?: PluginJobMetadata;
	input?: unknown;
}

export type JobPatch = Partial<Omit<JobRecord, "id" | "kind" | "chatId" | "toolCallId" | "createdAt">>;

export interface JobStore {
	createJob(init: CreateJobInit): JobRecord;
	getJob(id: string): JobRecord | null;
	updateJob(id: string, patch: JobPatch): JobRecord | null;
	listJobs(chatId: string): JobRecord[];
	findJobByToolCallId(chatId: string, toolCallId: string): JobRecord | null;
	deleteJobsForChat(chatId: string): number;
}


export interface SettingsStore {
	readSettings(): UserSettings | null;
	writeSettings(settings: UserSettings): void;
}


export interface AuthStore {
	authVars(): Record<string, string>;
	setAuthVar(name: string, value: string): void;
	deleteAuthVar(name: string): void;
}
