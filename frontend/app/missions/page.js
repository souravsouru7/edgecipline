"use client";

import { Suspense, useState } from "react";
import { Target, Sparkles, Search } from "lucide-react";
import PageHeader from "@/features/shared/components/PageHeader";
import { Button, Card, EmptyState, Placeholder, SegmentedControl } from "@/features/shared/components/ui";
import { useActiveMissions, useMissionStats, useGetRecommendations, useMissionTemplates } from "@/features/missions/hooks/useMissions";
import MissionCard from "@/features/missions/components/MissionCard";
import MissionHistory from "@/features/missions/components/MissionHistory";
import { CategoryBadge, DifficultyDot } from "@/features/missions/components/MissionProgress";

const CATEGORIES = [
  { value: "all", label: "All" },
  { value: "risk_management", label: "Risk" },
  { value: "discipline", label: "Discipline" },
  { value: "psychology", label: "Psychology" },
  { value: "journal", label: "Journal" },
  { value: "strategy", label: "Strategy" },
];

function Loading() {
  return (
    <div className="ec-disc__stack" aria-busy="true">
      <Placeholder height={96} radius={14} />
      <Placeholder height={96} radius={14} />
    </div>
  );
}

export default function MissionsPage() {
  const [tab, setTab] = useState("active");
  const [categoryKey, setCategoryKey] = useState("all");
  const category = categoryKey === "all" ? null : categoryKey;

  const { data: activeMissionsData, isLoading: loadingActive } = useActiveMissions();
  const { data: stats } = useMissionStats();
  const { data: templatesData, isLoading: loadingTemplates } = useMissionTemplates({ category });
  const getRecommendations = useGetRecommendations();

  const allMissions = activeMissionsData?.data || [];
  const activeMissions = allMissions.filter((m) => m.status === "active");
  const availableMissions = allMissions.filter((m) => m.status === "available");
  const visibleRecommended = availableMissions.filter((m) => !category || m.category === category);
  const templates = (templatesData?.data || []).filter((t) => !category || t.category === category);
  const counts = stats?.data || {};

  const analyzeCta = availableMissions.length === 0 && activeMissions.length < 3 && (
    <Card>
      <div className="ec-mission__cta">
        <span className="ec-mission__cta-icon" aria-hidden="true"><Sparkles size={18} /></span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="ec-disc__row-title">Get missions picked for you</div>
          <div className="ec-disc__row-meta">Your coach looks at your recent trading and suggests the habits worth building.</div>
          {getRecommendations.isError && <p className="ec-streak__err" role="alert">{"Couldn't analyse right now. Try again."}</p>}
        </div>
        <Button onClick={() => getRecommendations.mutate({})} loading={getRecommendations.isPending}>Analyse</Button>
      </div>
    </Card>
  );

  return (
    <div className="ec-app ec-home">
      <PageHeader themed showMarketSwitcher title="Missions" />
      <main className="ec-page ec-disc">
        <div className="ec-log__head">
          <div style={{ minWidth: 0 }}>
            <h1 className="ec-log__title">Missions</h1>
            <p className="ec-log__sub">Small, measurable habits that build discipline.</p>
          </div>
        </div>

        <div className="ec-mission__stats">
          <div><strong className="ec-tone--good">{counts.completed ?? 0}</strong><span>Completed</span></div>
          <div><strong className="ec-tone--warn">{counts.active ?? 0}</strong><span>Active</span></div>
          <div><strong>{counts.archived ?? 0}</strong><span>Archived</span></div>
        </div>

        {analyzeCta}

        <div className="ec-mission__tabs">
          <SegmentedControl
            mode="tabs"
            label="Missions view"
            value={tab}
            onChange={setTab}
            options={[
              { value: "active", label: `Active${activeMissions.length ? ` (${activeMissions.length})` : ""}` },
              { value: "recommended", label: `For you${availableMissions.length ? ` (${availableMissions.length})` : ""}` },
              { value: "browse", label: "Browse" },
              { value: "history", label: "History" },
            ]}
          />
        </div>

        {(tab === "browse" || tab === "recommended") && (
          <div className="ec-mission__cats" role="group" aria-label="Category">
            {CATEGORIES.map((c) => (
              <button
                key={c.value}
                type="button"
                aria-pressed={categoryKey === c.value}
                className={`ec-mission__cat ec-focusable${categoryKey === c.value ? " is-on" : ""}`}
                onClick={() => setCategoryKey(c.value)}
              >
                {c.label}
              </button>
            ))}
          </div>
        )}

        {tab === "active" && (
          loadingActive ? <Loading /> : activeMissions.length === 0 ? (
            <Card>
              <EmptyState
                icon={<Target size={22} />}
                title="No active missions"
                body="Accept a mission picked for you, or browse them all."
                action={<Button onClick={() => setTab("recommended")}>See missions for you</Button>}
              />
            </Card>
          ) : (
            <div className="ec-disc__stack" style={{ gap: 10 }}>
              {activeMissions.map((m) => <MissionCard key={m.id} mission={m} showActions />)}
            </div>
          )
        )}

        {tab === "recommended" && (
          loadingActive ? <Loading /> : visibleRecommended.length === 0 ? (
            <Card>
              <EmptyState
                icon={<Sparkles size={22} />}
                title={availableMissions.length ? "Nothing in this category" : "No suggestions yet"}
                body={availableMissions.length ? "Pick another category to see the rest." : "Tap Analyse above to get missions based on your trading."}
              />
            </Card>
          ) : (
            <div className="ec-disc__stack" style={{ gap: 10 }}>
              {visibleRecommended.map((m) => <MissionCard key={m.id} mission={m} showActions />)}
            </div>
          )
        )}

        {tab === "browse" && (
          loadingTemplates ? <Loading /> : templates.length === 0 ? (
            <Card><EmptyState icon={<Search size={22} />} title="No missions here" body="Try another category." /></Card>
          ) : (
            <div className="ec-disc__stack" style={{ gap: 10 }}>
              {templates.map((t) => (
                <article key={t._id} className="ec-mission">
                  <div className="ec-mission__head" style={{ cursor: "default" }}>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span className="ec-mission__tags">
                        <CategoryBadge category={t.category} />
                        <DifficultyDot difficulty={t.difficulty} />
                      </span>
                      <span className="ec-mission__name">{t.name}</span>
                      {t.description && <span className="ec-mission__desc" style={{ display: "block", marginTop: 6 }}>{t.description}</span>}
                      <span className="ec-disc__row-meta" style={{ display: "block", marginTop: 8 }}>Target: {t.target} {t.unit}</span>
                    </span>
                  </div>
                </article>
              ))}
            </div>
          )
        )}

        {tab === "history" && (
          <Suspense fallback={<Loading />}>
            <MissionHistory />
          </Suspense>
        )}
      </main>
    </div>
  );
}
