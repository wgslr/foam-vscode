/**
 * Adapted from vscode-markdown/src/toc.ts
 * https://github.com/yzhang-gh/vscode-markdown/blob/master/src/toc.ts
 */
"use strict";

import {
  CancellationToken,
  CodeLens,
  CodeLensProvider,
  commands,
  EndOfLine,
  ExtensionContext,
  languages,
  Range,
  TextEditor,
  TextDocument,
  TextDocumentWillSaveEvent,
  window,
  workspace,
  Position,
} from "vscode";

import { basename } from "path";
import * as ws from "./workspace";

/**
 * Workspace config
 */
const docConfig = { tab: "  ", eol: "\r\n" };
const mdDocSelector = [
  { language: "markdown", scheme: "file" },
  { language: "markdown", scheme: "untitled" },
];

function loadDocConfig() {
  // Load workspace config
  let activeEditor = window.activeTextEditor;
  if (!activeEditor) {
    console.log("Failed to load config, no active editor");
    return;
  }

  docConfig.eol = activeEditor.document.eol === EndOfLine.CRLF ? "\r\n" : "\n";

  let tabSize = Number(activeEditor.options.tabSize);
  let insertSpaces = activeEditor.options.insertSpaces;
  if (insertSpaces) {
    docConfig.tab = " ".repeat(tabSize);
  } else {
    docConfig.tab = "\t";
  }
}

const REFERENCE_HEADER = `[//begin]: # "Autogenerated link references for markdown compatibility"`;
const REFERENCE_FOOTER = `[//end]: # "Autogenerated link references"`;

export function activate(context: ExtensionContext) {
  context.subscriptions.push(
    commands.registerCommand(
      "foam-vscode.update-wikilinks",
      updateReferenceList
    ),
    workspace.onWillSaveTextDocument(onWillSave),
    languages.registerCodeLensProvider(
      mdDocSelector,
      new WikilinkReferenceCodeLensProvider()
    )
  );
}

async function createReferenceList() {
  let editor = window.activeTextEditor;
  if (!editor || !isMdEditor(editor)) {
    return;
  }

  let refs = await generateReferenceList(editor.document);
  if (refs && refs.length) {
    await editor.edit(function (editBuilder) {
      if (editor) {
        editBuilder.insert(
          new Position(editor.document.lineCount + 1, 0),
          docConfig.eol + refs.join(docConfig.eol) + docConfig.eol
        );
      }
    });
  }
}

async function updateReferenceList() {
  const editor = window.activeTextEditor;

  if (!editor || !isMdEditor(editor)) {
    return;
  }

  loadDocConfig();

  const doc = editor.document;
  const range = detectReferenceListRange(doc);

  if (!range) {
    await createReferenceList();
  } else {
    const refs = await generateReferenceList(doc);
    await editor.edit((editBuilder) => {
      editBuilder.replace(range, refs.join(docConfig.eol) + docConfig.eol);
    });
  }
}

async function generateReferenceList(doc: TextDocument): Promise<string[]> {
  const filename = basename(doc.fileName);
  const id = filename.split(".")[0];

  // @todo fix hack
  await ws.ready;

  // update file in index for future reference
  // @todo should probably be an update method instead
  // so we can prune existing references
  ws.manager.addNoteFromMarkdown(filename, doc.getText());

  // find note by id
  const note = ws.manager.getNoteWithLinks(id);

  if (note.linkedNotes.length === 0) {
    return [];
  }

  const references = [];

  for (const link of note.linkedNotes) {
    // [wiki-link-text]: wiki-link "Page title"
    references.push(`[${link.id}]: ${link.id.split(".")[0]} "${link.title}"`);
  }

  // for (const backlink of note.backlinks) {
  //   references.push(
  //     `[backlink:${backlink.id}]: ${backlink.filename} "${backlink.title}"`
  //   );
  // }

  return [REFERENCE_HEADER, ...references, REFERENCE_FOOTER];
}

/**
 * Find the range of existing reference list
 * @param doc
 */
function detectReferenceListRange(doc: TextDocument): Range {
  const fullText = doc.getText();

  // find line number of header, and assume 0 for line start
  // if header is not found, this will be last line of the file
  const header = [
    fullText.split(REFERENCE_HEADER)[0].split(docConfig.eol).length - 1,
    0,
  ];

  // find line number and char position where footer ends
  const footer = [
    fullText.split(REFERENCE_FOOTER)[0].split(docConfig.eol).length,
    0,
  ];

  // if header and footer are on the same line, that means we have no references section
  if (header[0] === footer[0]) {
    return null;
  }

  return new Range(
    new Position(header[0], header[1]),
    new Position(footer[0], footer[1])
  );
}

function onWillSave(e: TextDocumentWillSaveEvent) {
  if (e.document.languageId === "markdown") {
    e.waitUntil(updateReferenceList());
  }
}

function getText(range: Range): string {
  return window.activeTextEditor.document.getText(range);
}

function isMdEditor(editor: TextEditor) {
  return editor && editor.document && editor.document.languageId === "markdown";
}

class WikilinkReferenceCodeLensProvider implements CodeLensProvider {
  public provideCodeLenses(
    document: TextDocument,
    _: CancellationToken
  ): CodeLens[] | Thenable<CodeLens[]> {
    let range = detectReferenceListRange(document);
    if (!range) {
      return [];
    }

    return generateReferenceList(document).then((refs) => {
      let status =
        getText(range).replace(/\r?\n|\r/g, docConfig.eol) ===
        refs.join(docConfig.eol)
          ? "up to date"
          : "out of date";

      return [
        new CodeLens(range, {
          arguments: [],
          title: `Link references (${status})`,
          command: "",
        }),
      ];
    });
  }
}
