import { join } from 'node:path';
import { readWorkflow, type Workflow, type WorkflowNode } from '../../scripts/lib/workflow.ts';

const WORKFLOWS_DIR = 'workflows';

/** Reads `workflows/<file>`. */
export function workflowFile(file: string): Workflow {
  return readWorkflow(join(WORKFLOWS_DIR, file));
}

/** The named node, or throws when it's missing from the workflow. */
export function nodeOf(wf: Workflow, name: string): WorkflowNode {
  const node = wf.nodes.find((n) => n.name === name);
  if (!node) throw new Error(`node ${name} not found in workflow ${wf.name}`);
  return node;
}

/** The names of the nodes wired into `node`'s input `input` (0-based), across every connection type. */
export function sourcesOf(wf: Workflow, node: string, input: number): string[] {
  const sources: string[] = [];
  for (const [sourceName, byType] of Object.entries(wf.connections)) {
    if (byType === null || typeof byType !== 'object') continue;
    for (const outputs of Object.values(byType as Record<string, unknown>)) {
      if (!Array.isArray(outputs)) continue;
      for (const branch of outputs as unknown[]) {
        if (!Array.isArray(branch)) continue;
        for (const connection of branch as { node: string; index: number }[]) {
          if (connection.node === node && connection.index === input) sources.push(sourceName);
        }
      }
    }
  }
  return sources;
}
