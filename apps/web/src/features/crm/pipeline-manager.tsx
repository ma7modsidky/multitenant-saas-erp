'use client';

// Pipeline management (CRM-17) — list every pipeline the caller can see,
// create pipelines from scratch or the shipped templates, edit stages
// (rename, probability, add, reorder, remove), promote the default (CRM-3),
// and delete empty non-default pipelines. Every mutation requires
// `crm:pipeline:manage` (the server re-checks; the UI gate is UX only).

import { ArrowDown, ArrowUp, GitBranch, Plus, Star, Trash2, X } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectItem } from '@/components/ui/select';
import { Can } from '@/lib/permissions';

import { crmErrorKey } from './errors';
import { usePipelines, usePipelineMutations, useTeams } from './hooks';

/** Local draft stage while composing a new pipeline. */
interface DraftStage {
  name: string;
  probability: number;
  isWon: boolean;
  isLost: boolean;
}

/** Minimal i18n: the org can translate names later (I18N-5 en fallback). */
function toNameI18n(name: string): Record<string, string> {
  return { en: name };
}

export function PipelineManager() {
  const t = useTranslations('modules.crm');
  const locale = useLocale();
  const { data: pipelines, isPending } = usePipelines();
  const { data: teams } = useTeams();
  const mutations = usePipelineMutations();
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Draft state for the create form.
  const [name, setName] = useState('');
  const [teamId, setTeamId] = useState('');
  const [stages, setStages] = useState<DraftStage[]>([
    { name: 'New', probability: 10, isWon: false, isLost: false },
    { name: 'Won', probability: 100, isWon: true, isLost: false },
    { name: 'Lost', probability: 0, isWon: false, isLost: true },
  ]);

  const run = (promise: Promise<unknown>) =>
    promise.then(() => setError(null)).catch((err: unknown) => setError(t(crmErrorKey(err))));

  const submit = () => {
    if (!name.trim() || stages.length === 0) return;
    void run(
      mutations.createPipeline.mutateAsync({
        nameI18n: toNameI18n(name.trim()),
        ownerTeamId: teamId || null,
        stages: stages.map((s) => ({
          nameI18n: toNameI18n(s.name.trim() || 'Stage'),
          probability: s.probability,
          isWon: s.isWon,
          isLost: s.isLost,
        })),
      }),
    ).then(() => {
      setShowForm(false);
      setName('');
      setTeamId('');
    });
  };

  const moveStage = (index: number, direction: -1 | 1) => {
    setStages((current) => {
      const next = [...current];
      const target = index + direction;
      if (target < 0 || target >= next.length) return current;
      const a = next[index];
      const b = next[target];
      if (!a || !b) return current;
      next[index] = b;
      next[target] = a;
      return next;
    });
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <header className="flex flex-col gap-4 rounded-xl border bg-card p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <span className="rounded-lg bg-primary p-2 text-primary-foreground">
            <GitBranch className="size-5" />
          </span>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{t('pipelines.title')}</h1>
            <p className="text-sm text-muted-foreground">{t('pipelines.subtitle')}</p>
          </div>
        </div>
        <Can permission="crm:pipeline:manage">
          <Button onClick={() => setShowForm(!showForm)}>
            <Plus />
            {t('pipelines.create')}
          </Button>
        </Can>
      </header>

      {error && (
        <div
          role="alert"
          className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          {error}
        </div>
      )}

      {showForm && (
        <Card>
          <CardHeader>
            <CardTitle>{t('pipelines.create')}</CardTitle>
            <CardDescription>{t('pipelines.createHint')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="pipeline-name">{t('pipelines.name')}</Label>
                <Input id="pipeline-name" dir="auto" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="pipeline-team">{t('pipelines.team')}</Label>
                <Select id="pipeline-team" value={teamId} onValueChange={setTeamId}>
                  <SelectItem value="">{t('pipelines.allOrg')}</SelectItem>
                  {(teams ?? []).map((team) => (
                    <SelectItem key={team.id} value={team.id}>
                      {team.name}
                    </SelectItem>
                  ))}
                </Select>
              </div>
            </div>

            {/* Quick templates (CRM-17) — apply a preset stage set. */}
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  setStages([
                    { name: 'New', probability: 10, isWon: false, isLost: false },
                    { name: 'Contacted', probability: 20, isWon: false, isLost: false },
                    { name: 'Proposal', probability: 50, isWon: false, isLost: false },
                    { name: 'Negotiation', probability: 70, isWon: false, isLost: false },
                    { name: 'Won', probability: 100, isWon: true, isLost: false },
                    { name: 'Lost', probability: 0, isWon: false, isLost: true },
                  ])
                }
              >
                {t('pipelines.templateB2b')}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  setStages([
                    { name: 'New', probability: 10, isWon: false, isLost: false },
                    { name: 'Qualified', probability: 40, isWon: false, isLost: false },
                    { name: 'Won', probability: 100, isWon: true, isLost: false },
                    { name: 'Lost', probability: 0, isWon: false, isLost: true },
                  ])
                }
              >
                {t('pipelines.templateSimple')}
              </Button>
            </div>

            <div className="space-y-2">
              <Label>{t('pipelines.stages')}</Label>
              {stages.map((stage, index) => (
                <div key={index} className="flex flex-wrap items-end gap-2 rounded-lg border p-3">
                  <div className="min-w-40 flex-1 space-y-1">
                    <Label htmlFor={`stage-name-${index}`} className="text-xs text-muted-foreground">
                      {t('pipelines.stageName')}
                    </Label>
                    <Input
                      id={`stage-name-${index}`}
                      dir="auto"
                      value={stage.name}
                      onChange={(e) =>
                        setStages((cur) => cur.map((s, i) => (i === index ? { ...s, name: e.target.value } : s)))
                      }
                    />
                  </div>
                  <div className="w-28 space-y-1">
                    <Label htmlFor={`stage-prob-${index}`} className="text-xs text-muted-foreground">
                      {t('pipelines.stageProbability')}
                    </Label>
                    <Input
                      id={`stage-prob-${index}`}
                      type="number"
                      min={0}
                      max={100}
                      value={stage.probability}
                      onChange={(e) =>
                        setStages((cur) =>
                          cur.map((s, i) =>
                            i === index
                              ? { ...s, probability: Math.max(0, Math.min(100, Number(e.target.value) || 0)) }
                              : s,
                          ),
                        )
                      }
                    />
                  </div>
                  <div className="flex items-center gap-1 pb-1">
                    <Button
                      type="button"
                      variant={stage.isWon ? 'secondary' : 'ghost'}
                      size="sm"
                      aria-pressed={stage.isWon}
                      onClick={() =>
                        setStages((cur) =>
                          cur.map((s, i) =>
                            i === index ? { ...s, isWon: !s.isWon, isLost: false } : { ...s, isWon: false },
                          ),
                        )
                      }
                    >
                      <Star />
                      {t('deals.won')}
                    </Button>
                    <Button
                      type="button"
                      variant={stage.isLost ? 'secondary' : 'ghost'}
                      size="sm"
                      aria-pressed={stage.isLost}
                      onClick={() =>
                        setStages((cur) =>
                          cur.map((s, i) =>
                            i === index ? { ...s, isLost: !s.isLost, isWon: false } : { ...s, isLost: false },
                          ),
                        )
                      }
                    >
                      {t('deals.lost')}
                    </Button>
                  </div>
                  <div className="flex items-center gap-1 pb-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      disabled={index === 0}
                      aria-label={t('pipelines.moveUp')}
                      onClick={() => moveStage(index, -1)}
                    >
                      <ArrowUp className="size-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      disabled={index === stages.length - 1}
                      aria-label={t('pipelines.moveDown')}
                      onClick={() => moveStage(index, 1)}
                    >
                      <ArrowDown className="size-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      aria-label={t('common.close')}
                      onClick={() => setStages((cur) => cur.filter((_, i) => i !== index))}
                    >
                      <X className="size-4" />
                    </Button>
                  </div>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  setStages((cur) => [
                    ...cur.slice(0, Math.max(0, cur.length - 2)),
                    { name: '', probability: 50, isWon: false, isLost: false },
                    ...cur.slice(Math.max(0, cur.length - 2)),
                  ])
                }
              >
                <Plus />
                {t('pipelines.addStage')}
              </Button>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button onClick={submit} loading={mutations.createPipeline.isPending}>
                {t('pipelines.create')}
              </Button>
              <Button type="button" variant="outline" onClick={() => setShowForm(false)}>
                {t('common.close')}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {isPending ? (
        <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
          {t('common.loading')}
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {(pipelines ?? []).map((pipeline) => {
            const stageList = [...pipeline.stages].sort((a, b) => a.position - b.position);
            const team = teams?.find((team) => team.id === pipeline.ownerTeamId);
            return (
              <Card key={pipeline.id}>
                <CardHeader>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <CardTitle dir="auto" className="flex items-center gap-2">
                        {pipeline.nameI18n[locale] ?? pipeline.nameI18n.en}
                        {pipeline.isDefault && <Badge variant="secondary">{t('pipelines.defaultBadge')}</Badge>}
                      </CardTitle>
                      <CardDescription>
                        {team ? t('pipelines.teamScope', { team: team.name }) : t('pipelines.orgScope')}
                      </CardDescription>
                    </div>
                    <Can permission="crm:pipeline:manage">
                      <div className="flex items-center gap-1">
                        {!pipeline.isDefault && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8"
                            aria-label={t('pipelines.setDefault')}
                            title={t('pipelines.setDefault')}
                            disabled={mutations.setDefault.isPending}
                            onClick={() => void run(mutations.setDefault.mutateAsync(pipeline.id))}
                          >
                            <Star className="size-4" />
                          </Button>
                        )}
                        {!pipeline.isDefault && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8"
                            aria-label={t('pipelines.delete')}
                            title={t('pipelines.delete')}
                            disabled={mutations.deletePipeline.isPending}
                            onClick={() => {
                              if (window.confirm(t('pipelines.deleteConfirm'))) {
                                void run(mutations.deletePipeline.mutateAsync(pipeline.id));
                              }
                            }}
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        )}
                      </div>
                    </Can>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2">
                  {stageList.map((stage, index) => (
                    <div key={stage.id} className="flex items-center justify-between gap-2 text-sm">
                      <span className="flex min-w-0 items-center gap-2" dir="auto">
                        <span className="text-xs text-muted-foreground">{index + 1}.</span>
                        <span className="truncate">{stage.nameI18n[locale] ?? stage.nameI18n.en}</span>
                        {stage.isWon && <Badge variant="default">{t('deals.won')}</Badge>}
                        {stage.isLost && <Badge variant="destructive">{t('deals.lost')}</Badge>}
                      </span>
                      <span className="flex shrink-0 items-center gap-2">
                        <span
                          className="hidden h-1.5 w-20 overflow-hidden rounded-full bg-muted sm:block"
                          role="meter"
                          aria-valuenow={stage.successPercent ?? stage.probability}
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-label={(stage.nameI18n[locale] ?? stage.nameI18n.en) + ' ' + t('pipelines.success')}
                        >
                          <span
                            className="block h-full rounded-full bg-primary"
                            style={{
                              width: `${Math.min(100, Math.max(0, stage.successPercent ?? stage.probability))}%`,
                            }}
                          />
                        </span>
                        <span className="w-10 text-end font-mono text-xs tabular-nums text-muted-foreground">
                          {stage.successPercent ?? stage.probability}%
                        </span>
                      </span>
                    </div>
                  ))}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
