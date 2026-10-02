import { classify, completeEvidence, newReceipt } from './core.ts';
import { redact } from './io.ts';
import { REPO, type Driver, type GitHub, type Receipt, type Registry } from './types.ts';

class HeadMoved extends Error {}
const safe = (text: string): string => redact(text).replace(/[`<>\r\n]/g, ' ').slice(0, 2000);
export function evidence(receipt: Receipt): string {
  const lines = ['## Live evidence: Open Pstack', `Pinned PR #${receipt.pr}: \`${receipt.sha}\` (base \`${receipt.base}\`).`,
    `Result: ${receipt.failure ? `FAILED — ${safe(receipt.failure)}` : receipt.selection.noRuntime ? 'no runtime change' : 'all mapped features passed'}.`,
    `Self-test: ${receipt.selfTest ? 'required in both harnesses' : 'not requested'}.`,
    `Retained receipt: \`${safe(receipt.artifactRoot)}/receipt.json\`. Local CLI checks are not installed-harness evidence.`];
  for (const install of receipt.installations) lines.push(`- ${install.harness}: CLI ${safe(install.cliVersion)}, plugin ${safe(install.pluginVersion)}, SHA \`${install.sha}\`, tree \`${install.treeHash}\`, isolated \`${safe(install.location)}\`.`);
  for (const record of receipt.observations) lines.push(`- ${record.harness} / ${safe(record.feature)}: ${safe(record.surface)}; action: ${safe(record.action)}; observed: ${safe(record.observed)}; operator reviewed.`,
    `  Transcript \`${safe(record.transcript)}\` SHA-256 \`${record.transcriptHash}\`; artifacts ${record.artifacts.map(a => `\`${safe(a.path)}\` (\`${a.sha256}\`)`).join(', ')}.`);
  lines.push('Every new head requires a fresh run, including queue-created heads. This helper never queues or merges.');
  return lines.join('\n');
}
export async function verify(options: { pr: number; selfTest: boolean; root: string; registry: Registry; github: GitHub; driver: Driver; persist: (receipt: Receipt) => Promise<void> }): Promise<Receipt> {
  const { github, driver, persist } = options;
  const initial = await github.pull(options.pr);
  if (initial.state !== 'open' || initial.headRepo !== REPO) throw new Error('Require an open same-repository PR');
  const receipt = newReceipt(options.pr, initial.head.sha, initial.base.sha, options.selfTest, options.root);
  let successAttempted = false, readyAttempted = false;
  const current = async (): Promise<void> => {
    const pull = await github.pull(receipt.pr);
    if (pull.head.sha !== receipt.sha || pull.base.sha !== receipt.base || pull.state !== 'open' || pull.headRepo !== REPO) throw new HeadMoved('PR head/base or open repository identity changed; run again');
  };
  const phase = async (next: Receipt['phase']): Promise<void> => { receipt.phase = next; await persist(receipt); await current(); };
  try {
    await phase('classify');
    receipt.selection = classify(await github.files(receipt.pr), options.registry);
    await current(); await persist(receipt);
    if (!receipt.selection.noRuntime || receipt.selfTest) {
      await phase('prepare'); receipt.installations = await driver.prepare(receipt); await current(); await persist(receipt);
      await phase('exercise'); receipt.observations = await driver.exercise(receipt); await current(); await persist(receipt);
    }
    completeEvidence(receipt);
    await phase('publish');
    receipt.commentUrl = await github.comment(receipt.pr, evidence(receipt)); await persist(receipt); await current();
    successAttempted = true;
    await github.status(receipt.sha, 'success', receipt.commentUrl, receipt.selection.noRuntime ? 'no runtime change' : 'All mapped features passed in both harnesses');
    receipt.status = 'success'; await persist(receipt); await current();
    if (initial.draft) {
      await phase('ready'); readyAttempted = true; await github.ready(receipt.pr); receipt.madeReady = true; await persist(receipt); await current();
    }
    await persist(receipt); return receipt;
  } catch (error) {
    receipt.failure = redact(error instanceof Error ? error.message : String(error));
    receipt.phase = error instanceof HeadMoved ? 'head-moved' : 'failed';
    receipt.compensation = [];
    const recover = async (label: string, operation: () => Promise<void>): Promise<void> => {
      try { await operation(); receipt.compensation!.push(`${label}: done`); }
      catch (failure) { receipt.compensation!.push(`${label}: FAILED ${redact(String(failure))}`); }
    };
    // Withdraw an attempted success on its original SHA even if the current head has moved.
    if (successAttempted && receipt.commentUrl) await recover('withdraw success on pinned SHA', async () => {
      await github.status(receipt.sha, 'failure', receipt.commentUrl!, 'Verification aborted; rerun required'); receipt.status = 'failure';
    });
    if (readyAttempted) await recover('restore draft', async () => { await github.draft(receipt.pr); receipt.madeReady = false; });
    if (!successAttempted) await recover('publish pinned failure', async () => {
      await current();
      receipt.commentUrl = await github.comment(receipt.pr, evidence(receipt)); await current();
      await github.status(receipt.sha, 'failure', receipt.commentUrl, 'Verification failed; see retained evidence'); receipt.status = 'failure'; await current();
    });
    await persist(receipt); throw new Error(receipt.failure);
  }
}
