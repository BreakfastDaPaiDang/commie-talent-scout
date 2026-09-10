import {TopBar,ArchiveHead} from '../../../app/ui/Workspace';
import {AuxiliaryTools} from '../../../app/ui/AuxiliaryTools';
import React from "react";
import { Icon, Mark } from "./icons.jsx";
import { Avatar, Placeholder } from "./Avatar.jsx";
import {
  Button,
  IconButton,
  Login,
  Feedback,
  FeedbackContext,
} from "./components.jsx";
import {
  ArchiveList,
  ArchiveSearch,
  Updates,
  Detail,
} from "./WorkspaceViews.jsx";
import { Accounts, AgentPage, Dialogs } from "./SupportingViews.jsx";
import { useWorkspace } from "./useWorkspace.js";
const labels = {
  person: "人物",
  org: "组织",
  unread: "未读更新",
  accounts: "猎头管理",
  agent: "Agent 接入",
};
export default function App() {
  const w = useWorkspace();
  if (!w.loggedIn)
    return (
      <Login
        onLogin={() => {
          w.setLoggedIn(true);
          w.notify("已进入演示工作台");
        }}
      />
    );
  return (
    <div
      className={`app ${w.detailVisible ? "has-detail" : ""} ${w.detailWide ? "expanded-detail" : ""}`}
    >
      <TopBar onHome={()=>w.navigate('person')} navigation={<>
          {[
            ["person", "人物"],
            ["org", "组织"],
            ["unread", "未读更新"],
          ].map(([key, label]) => (
            <button
              className={w.page === key ? "active" : ""}
              aria-current={w.page === key ? "page" : undefined}
              key={key}
              onClick={() => w.navigate(key)}
            >
              {label}
              {key === "unread" && w.unreadEntities.length > 0 && (
                <b>{w.unreadEntities.length}</b>
              )}
            </button>
          ))}
</>} tools={<>
          <button
            className={`tool-link ${w.page === "agent" ? "active" : ""}`}
            onClick={() => w.navigate("agent")}
          >
            <Icon name="agent" />
            <span>Agent 接入</span>
          </button>
          {w.actor.role === "admin" && (
            <IconButton
              name="settings"
              label="猎头管理"
              onClick={() => w.navigate("accounts")}
            />
          )}
          <button
            className="current-member"
            title="猎头账号"
            onClick={() => w.setDialog({ type: "profile" })}
          >
            <Avatar
              name={w.actor.name}
              src={w.actor.avatar}
              qq={w.actor.qq}
              size="tiny"
            />
            <span>{w.actor.name}</span>
            <Icon name="down" size={15} />
          </button>
          <span className="prototype-tag">原型</span>
</>} mobileTools={<>
        <IconButton
          name="menu"
          label="打开工具导航"
          onClick={() => w.setMenuOpen(!w.menuOpen)}
        />
</>}/>

      {w.menuOpen && (
        <div className="mobile-menu">
          <Button icon="agent" onClick={() => w.navigate("agent")}>
            Agent 接入
          </Button>
          <Button onClick={() => w.navigate("tools")}>辅助工具</Button>
          {w.actor.role === "admin" && (
            <Button icon="settings" onClick={() => w.navigate("accounts")}>
              猎头管理
            </Button>
          )}
          <Button
            onClick={() => {
              w.setMenuOpen(false);
              w.setDialog({ type: "profile" });
            }}
          >
            猎头账号：{w.actor.name}
          </Button>
        </div>
      )}
      {w.page === "tools" ? <AuxiliaryTools/> : <div
        className={`workspace ${["accounts", "agent"].includes(w.page) ? "support-workspace" : ""}`}
      >
        <main
          className={`main-panel ${["accounts", "agent"].includes(w.page) ? "support-panel" : ""}`}
        >
          {['person','org'].includes(w.page)?<ArchiveHead label={labels[w.page]} count={w.entities.filter(e=>e.type===w.page).length.toString().padStart(2,'0')} query={w.search} onQuery={w.setSearch} onCreate={()=>w.setDialog({type:'entity-new'})}/>:(          <header
            className={`page-head ${["person", "org"].includes(w.page) ? "archive-head" : ""}`}
          >
            <div>
              <span className="eyebrow">
                {
                  {
                    person: "PEOPLE",
                    org: "ORGANIZATIONS",
                    unread: "UPDATES",
                    accounts: "MEMBERS",
                    agent: "AGENT ACCESS",
                  }[w.page]
                }
              </span>
              <h1>
                {labels[w.page]}
                {["person", "org"].includes(w.page) && (
                  <span className="page-count">
                    {w.entities
                      .filter((e) => e.type === w.page)
                      .length.toString()
                      .padStart(2, "0")}
                  </span>
                )}
              </h1>
            </div>
            {["person", "org"].includes(w.page) && <ArchiveSearch w={w} />}
            {["person", "org"].includes(w.page) && (
              <Button
                variant="primary"
                icon="plus"
                onClick={() => w.setDialog({ type: "entity-new" })}
              >
                新建
              </Button>
            )}
            {w.page === "accounts" && (
              <Button
                variant="primary"
                icon="plus"
                onClick={() => w.setDialog({ type: "member-new" })}
              >
                新建账号
              </Button>
            )}
          </header>)}

          {["person", "org"].includes(w.page) && <ArchiveList w={w} />}
          {w.page === "unread" && <Updates w={w} />}
          {w.page === "accounts" && <Accounts w={w} />}
          {w.page === "agent" && <AgentPage w={w} />}
        </main>
        {w.detailVisible ? (
          <Detail w={w} />
        ) : (
          ["person", "org"].includes(w.page) && (
            <aside className="selection-rest" aria-hidden="true">
              <div className="rest-characters">
                <Placeholder type={w.page} />
              </div>
              <span>打开一个档案，继续观察。</span>
            </aside>
          )
        )}
      </div>}
      {!w.dialog && <Feedback toast={w.toast} />}
      <FeedbackContext.Provider value={w.toast}>
        <Dialogs w={w} />
      </FeedbackContext.Provider>
    </div>
  );
}
