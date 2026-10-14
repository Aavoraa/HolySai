import { useEffect, useState } from 'react';
import { api } from '@/api/client';
import { useApiMutation, useApiQuery } from '@/hooks/useApi';
import {
  Badge, Banner, Button, Card, ErrorState, Grid, Page, PageHead, PageSkeleton, SelectField, Switch, TextField,
} from '@/components/ui';
import { errorMessage } from '@/components/ui/states';
import { fmt } from '@/lib/format';
import { BASE, EV, Connecting, NotConnected, usePcStatus } from './shared';

interface AiConfig {
  config: {
    claude_enabled: boolean; claude_api_key: string | null; claude_vision_model: string; claude_eval_model: string; claude_effort: string;
    claude_timeout: number | null; max_retries: number | null; claude_refusal_fallback: boolean; external_processing_acknowledged: boolean;
    external_processing_acknowledged_by: { user: string; at: string } | null; redact_top_percent: number | null;
  };
  options: { models: { id: string; label: string }[]; efforts: string[] };
}
interface TestResult { ok: boolean; target: string; detail?: string; model?: string; duration_ms?: number; sample_text?: string; sample_name?: string | null }

/** Settings → AI Configuration for Paper Correction. The Claude key goes in and never comes back out. */
export default function AiSettingsPage() {
  const st = usePcStatus();
  const q = useApiQuery<AiConfig>(st.data?.connected && st.data.role === 'admin' ? `${EV}/settings/ai` : null);
  const [f, setF] = useState<Record<string, string | boolean>>({});
  const [key, setKey] = useState('');
  const [test, setTest] = useState<TestResult | 'running' | null>(null);
  useEffect(() => {
    const c = q.data?.config;
    if (!c) return;
    setF({
      claude_enabled: !!c.claude_enabled, claude_vision_model: c.claude_vision_model, claude_eval_model: c.claude_eval_model, claude_effort: c.claude_effort,
      claude_timeout: String(c.claude_timeout ?? ''), max_retries: String(c.max_retries ?? ''), claude_refusal_fallback: !!c.claude_refusal_fallback,
      external_processing_acknowledged: !!c.external_processing_acknowledged, redact_top_percent: String(c.redact_top_percent ?? 0),
    });
  }, [q.data]);
  const save = useApiMutation<{ changes: Record<string, unknown> }>('put', `${EV}/settings/ai`, {
    invalidate: ['/exam-correction'], success: 'AI configuration saved', onSuccess: () => setKey(''),
  });

  if (st.isLoading) return <Page><PageHead title="AI configuration" /><Connecting /></Page>;
  if (q.isLoading) return <Page><PageSkeleton /></Page>;
  if (st.data && !st.data.connected) return <Page><PageHead title="AI configuration" /><NotConnected status={st.data} onRetry={() => st.refetch()} /></Page>;
  if (st.data?.role !== 'admin') return <Page><PageHead title="AI configuration" /><Banner tone="neutral" icon="lock">Only administrators who manage settings can change the AI configuration.</Banner></Page>;
  if (q.error || !q.data) return <Page><PageHead title="AI configuration" /><ErrorState error={q.error} onRetry={() => q.refetch()} /></Page>;
  const { config: c, options } = q.data;
  const set = (k: string) => (v: string | boolean) => setF((x) => ({ ...x, [k]: v }));
  const models = (current: string) => {
    const opts = options.models.map((m) => ({ value: m.id, label: m.label }));
    return opts.some((o) => o.value === current) ? opts : [...opts, { value: current, label: current }];
  };
  const num = (v: string | boolean) => (v === '' ? null : Number(v));

  // A browser may autofill a saved sign-in password here; only accept something shaped like a Claude key.
  const keyError = key && !key.trim().startsWith('sk-ant-') ? 'This is not a Claude API key — they start with "sk-ant-". Clear the field if your browser filled in a password.' : '';
  const dirty = !!key || Object.entries(f).some(([k, v]) => {
    const cur = (c as unknown as Record<string, unknown>)[k];
    return typeof v === 'boolean' ? v !== !!cur : v !== String(cur ?? '');
  });
  const changes = () => ({
    changes: {
      claude_enabled: f.claude_enabled, claude_vision_model: f.claude_vision_model, claude_eval_model: f.claude_eval_model, claude_effort: f.claude_effort,
      claude_timeout: num(f.claude_timeout), max_retries: num(f.max_retries), claude_refusal_fallback: f.claude_refusal_fallback,
      external_processing_acknowledged: f.external_processing_acknowledged, redact_top_percent: num(f.redact_top_percent),
      ...(key ? { claude_api_key: key.trim() } : {}),
    },
  });
  const submit = () => { if (!keyError) save.mutate(changes()); };
  const runTest = async (target: 'reading' | 'marking', sample = false) => {
    if (keyError) return;
    setTest('running');
    try {
      if (dirty) await save.mutateAsync(changes()); // tests use the saved configuration
      setTest((await api.postLong<TestResult>(`${EV}/settings/ai/test/${target}${sample ? '?sample=true' : ''}`)).data);
    } catch (e) { setTest({ ok: false, target, detail: errorMessage(e) }); }
  };

  return (
    <Page>
      <PageHead title="AI configuration" crumbs={[{ label: 'Paper Correction', to: BASE }, { label: 'AI configuration' }]}
        sub="Claude reads the answer sheets and marks them. The API key is stored encrypted on the marking service and never shown again."
        actions={<Button variant="primary" icon="save" loading={save.isPending} onClick={submit}>Save configuration</Button>} />
      <Grid cols="g-2col">
        <Card icon="sparkle" title="Claude (Anthropic)">
          <div className="col g-3">
            <Switch checked={!!f.claude_enabled} onChange={set('claude_enabled')} label="Enabled" />
            <TextField label="Claude API key" type="password" name="claude-api-key" autoComplete="new-password" value={key}
              onChange={(v) => { setKey(v); if (v && !f.claude_enabled) set('claude_enabled')(true); }} error={keyError || undefined}
              placeholder={c.claude_api_key ? `set (${c.claude_api_key}) — type to replace` : 'not set'}
              hint="Stored encrypted; never sent back to the browser. On Render's free plan it is lost when the service sleeps — set EXAM_CLAUDE_API_KEY on the service instead." />
            <SelectField label="Model for reading sheets" value={f.claude_vision_model as string} onChange={set('claude_vision_model')} options={models(c.claude_vision_model)} />
            <SelectField label="Model for marking answers" value={f.claude_eval_model as string} onChange={set('claude_eval_model')} options={models(c.claude_eval_model)} />
            <div className="grid g-2col g-3">
              <SelectField label="Effort" value={f.claude_effort as string} onChange={set('claude_effort')} options={options.efforts} hint="Higher is more thorough, slower and costlier." />
              <TextField label="Timeout (seconds)" type="number" min={10} value={f.claude_timeout as string} onChange={set('claude_timeout')} />
            </div>
            <TextField label="Retries for temporary failures" type="number" min={0} max={5} value={f.max_retries as string} onChange={set('max_retries')} />
            <Switch checked={!!f.claude_refusal_fallback} onChange={set('claude_refusal_fallback')} label="Use Anthropic's server-side refusal fallback" />
          </div>
        </Card>
        <Card icon="shield" title="Sending student pages to Anthropic">
          <div className="col g-3">
            <Banner tone="warning" icon="alert">
              Every answer sheet is read by Claude, so photographs of students' work are sent to Anthropic. Before using it, make sure the
              school's consent and data-processing arrangements cover this (for children's data, parental consent).
            </Banner>
            <Switch checked={!!f.external_processing_acknowledged} onChange={set('external_processing_acknowledged')} label="I acknowledge this external processing on behalf of the school" />
            {c.external_processing_acknowledged_by && <p className="t-xs t-muted">Acknowledged by {c.external_processing_acknowledged_by.user}{c.external_processing_acknowledged_by.at ? ` on ${fmt.dateTime(c.external_processing_acknowledged_by.at)}` : ''}</p>}
            <TextField label="Blank this % of the top of page 1 before sending" type="number" min={0} max={50} value={f.redact_top_percent as string} onChange={set('redact_top_percent')}
              hint="0 = off. Blanking hides the name and roll number, but then the name on the sheet cannot be checked against the chosen student." />
          </div>
        </Card>
      </Grid>
      <div className="mt-4">
        <Card icon="activity" title="Test the connection" sub="Unsaved changes are saved first.">
          <div className="row g-2 wrap">
            <Button disabled={test === 'running'} onClick={() => runTest('marking')}>Test marking model</Button>
            <Button disabled={test === 'running'} onClick={() => runTest('reading')}>Test reading model</Button>
            <Button disabled={test === 'running'} onClick={() => runTest('reading', true)}>Read a sample page</Button>
          </div>
          {test === 'running' && <p className="t-sm t-muted mt-3">Testing…</p>}
          {test && test !== 'running' && (
            <div className="mt-3 col g-2">
              <div className="row g-2 wrap t-sm"><Badge tone={test.ok ? 'success' : 'critical'}>{test.ok ? 'OK' : 'FAILED'}</Badge>
                <span>{test.target}: {test.detail}{test.model ? ` · ${test.model}` : ''}{test.duration_ms ? ` · ${test.duration_ms} ms` : ''}</span></div>
              {test.sample_text && <div className="pc-answer">{test.sample_name ? `Name: ${test.sample_name}\n` : ''}{test.sample_text}</div>}
            </div>
          )}
        </Card>
      </div>
    </Page>
  );
}
