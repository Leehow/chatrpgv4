type Row = Record<string, any>;
export declare class CocOnboardingHost {
    private options;
    private root;
    private children;
    private busy;
    constructor(options: {
        repo: string;
        home: string;
        agentDir: string;
        env: NodeJS.ProcessEnv;
    });
    private folder;
    private load;
    private save;
    private snapshot;
    private run;
    private prepare;
    invoke(params: Row, session: string, model: {
        id: string;
        thinking: string;
        vision: boolean;
    }): Promise<Row>;
    dispose(): void;
}
export {};
