import * as puppeteer from 'puppeteer';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { MarkdownDocument } from '../common/markdownDocument';
import { mkdirsSync, mergeSettings } from '../common/tools';
import { renderPage } from './shared';
import { MarkdownExporter, exportFormat, Progress, ExportItem } from './interfaces';
import { config } from '../common/config';
import { context } from '../../extension';

class PuppeteerExporter implements MarkdownExporter {
    async Export(items: ExportItem[], progress: Progress) {
        let count = items.length;
        if (!await this.checkPuppeteerBinary()) {
            let result = await vscode.window.showInformationMessage("Do you want to download exporter dependency Chromium?", "Yes", "No");
            if (result == "Yes") {
                await this.fetchBinary(progress);
            } else {
                return Promise.reject("Download cancelled. Try configure 'markdownExtended.puppeteerExecutable' to use customize executable.");
            }
        }
        progress.report({ message: "Initializing..." });
        const browser = await puppeteer.launch(<puppeteer.LaunchOptions>{
            executablePath: config.puppeteerExecutable,
            // headless: false,
        });
        const page = await browser.newPage();

        return items.reduce(
            (p, c, i) => {
                return p
                    .then(
                        () => {
                            if (progress) progress.report({
                                message: `${path.basename(c.fileName)} (${i + 1}/${count})`,
                                increment: ~~(1 / count * 100)
                            });
                        }
                    )
                    .then(
                        () => this.exportFile(c, page)
                    );
            },
            Promise.resolve(null)
        ).then(async () => await browser.close())
            .catch(async err => {
                await browser.close();
                return Promise.reject(err);
            });

    }
    private async exportFile(item: ExportItem, page: puppeteer.Page) {
        let document = new MarkdownDocument(await vscode.workspace.openTextDocument(item.uri));
        let inject = getInjectStyle(item.format);
        let html = renderPage(document, inject);
        let ptConf: any = {};
        mkdirsSync(path.dirname(item.fileName));

        await page.setContent(html, { waitUntil: 'load' });
        switch (item.format) {
            case exportFormat.PDF:
                ptConf = mergeSettings(
                    config.puppeteerDefaultSetting.pdf,
                    config.puppeteerUserSetting.pdf,
                    document.meta.puppeteerPDF
                );
                ptConf = Object.assign(ptConf, { path: item.fileName });
                await page.pdf(ptConf);
                break;
            case exportFormat.JPG:
            case exportFormat.PNG:
                ptConf = mergeSettings(
                    config.puppeteerDefaultSetting.image,
                    config.puppeteerUserSetting.image,
                    document.meta.puppeteerImage
                );
                ptConf = Object.assign(ptConf, { path: item.fileName, type: item.format == exportFormat.JPG ? "jpeg" : "png" });
                if (item.format == exportFormat.PNG) ptConf.quality = undefined;
                await page.screenshot(ptConf);
                break;
            default:
                return Promise.reject("PuppeteerExporter does not support HTML export.");
        }
    }
    FormatAvailable(format: exportFormat) {
        return [
            exportFormat.PDF,
            exportFormat.JPG,
            exportFormat.PNG
        ].indexOf(format) > -1;
    }

    private async checkPuppeteerBinary() {
        if (config.puppeteerExecutable) return true;
        try {
            const execPath = await puppeteer.executablePath();
            return fs.existsSync(execPath);
        } catch {
            return false;
        }
    }
    
    private async fetchBinary(progress: Progress) {
        progress.report({
            message: "Downloading Chromium...",
        });
        try {
            // puppeteer v25+ handles browser downloads automatically
            // This will download the browser if it's not already present
            await puppeteer.launch({
                headless: true,
            }).then(browser => browser.close());
            progress.report({
                message: "Download complete",
                increment: 100
            });
        } catch (error) {
            return Promise.reject(`Failed to download Chromium: ${error}`);
        }
    }
}
export const puppeteerExporter = new PuppeteerExporter();

function getInjectStyle(formate: exportFormat): string {
    switch (formate) {
        case exportFormat.PDF:
            return `body, .vscode-body {
                max-width: 100% !important;
                width: 1000px !important;
                margin: 0!important;
                padding: 0!important;
            }`;
        case exportFormat.JPG:
        case exportFormat.PNG:
            return `body, .vscode-body {
                width: 1000px !important;
            }`
        default:
            return "";
    }
}