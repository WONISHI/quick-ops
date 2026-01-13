import * as vscode from 'vscode';
import { IFeature } from '../core/interfaces/IFeature';
import { ConfigurationService } from '../services/ConfigurationService';

export class ConfigManagementFeature implements IFeature {
    public readonly id = 'ConfigManagementFeature';

    constructor(
        private configService: ConfigurationService = ConfigurationService.getInstance()
    ) {}

    public activate(context: vscode.ExtensionContext): void {
        const createCmd = vscode.commands.registerCommand('extension.createLogrcFile', () => {
            this.configService.createDefaultConfig();
        });

        context.subscriptions.push(createCmd);
        console.log(`[${this.id}] Activated.`);
    }
}