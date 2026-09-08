import React, { useState } from "react";
import { Avatar, Placeholder } from "./Avatar.jsx";
import { Icon } from "./icons.jsx";
import { Button, Modal, Images } from "./components.jsx";
import { EntityForm, StateForm, RecordForm } from "./forms.jsx";
import { MemberPicker } from "./MemberPicker.jsx";
import { AvatarEditor } from "./AvatarEditor.jsx";
import { isWorkState, uuid, canViewRecord } from "./model.js";
import { protocolText } from "./protocol.js";

export function Accounts({ w }) {
  return (
    <section className="accounts-content">
      <p className="section-description">
        成员账号与访问权限。当前共有 {w.members.length} 名成员。
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>成员</th>
              <th>账号</th>
              <th>角色</th>
              <th>状态</th>
              <th>
                <span className="sr-only">操作</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {w.members.map((m) => (
              <tr key={m.id}>
                <td>
                  <span className="table-member">
                    <Avatar
                      name={m.name}
                      src={m.avatar}
                      qq={m.qq}
                      size="tiny"
                    />
                    <strong>{m.name}</strong>
                    {m.id === w.actorId && <small>你</small>}
                  </span>
                </td>
                <td>{m.username}</td>
                <td>{m.role === "admin" ? "管理员" : "普通成员"}</td>
                <td>
                  <span className={`account-state ${m.frozen ? "frozen" : ""}`}>
                    {m.frozen ? "已冻结" : "正常"}
                  </span>
                </td>
                <td>
                  <Button
                    variant="quiet"
                    onClick={() =>
                      w.setDialog({ type: "member-edit", member: m })
                    }
                  >
                    管理
                    <Icon name="arrow" size={16} />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
export function AgentPage({ w }) {
  return (
    <section className="agent-simple">
      <div className="agent-copy">
        <span className="eyebrow">使用说明</span>
        <h2>复制，交给你的 Agent。</h2>
        <p>
          把提示词粘贴到你常用的 Agent，
          <br />
          再把需要整理的材料交给它。
        </p>
        <p className="agent-examples">
          查找档案、整理近况、补充观察，
          <br />
          它会按你的成员权限协作。
        </p>
        <Button
          variant="primary"
          icon="copy"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(protocolText);
              w.notify("提示词已复制，粘贴给 Agent 即可");
            } catch {
              w.setDialog({ type: "protocol" });
            }
          }}
        >
          复制提示词给 Agent
        </Button>
      </div>
      <div className="agent-art" aria-hidden="true">
        <img src="/art/agent-handoff-v3.png" alt="" />
      </div>
    </section>
  );
}
export function Dialogs({ w }) {
  const { dialog, entity, actor, locked, closeDialog } = w;
  if (!dialog) return null;
  const work = entity && isWorkState(entity.type, entity.state);
  const titles = {
    "entity-new": `新建${w.page === "org" ? "组织" : "人物"}`,
    "entity-edit": "编辑档案资料",
    bindings: work ? "调整负责成员" : "调整关联成员",
    state:
      dialog.mode === "reopen"
        ? "重新开启"
        : dialog.mode === "close"
          ? "关闭档案"
          : "调整业务状态",
    "entity-actions": "档案操作",
    "record-edit": "编辑观察记录",
    "record-delete": "删除观察记录",
    history: "记录历史",
    image: "图片预览",
    profile: "猎头账号",
    "member-new": "新建账号",
    "member-edit": "管理账号",
    protocol: "Agent 使用说明",
  };
  return (
    <Modal
      title={titles[dialog.type]}
      onClose={closeDialog}
      wide={["history", "image", "protocol"].includes(dialog.type)}
    >
      {["entity-new", "entity-edit"].includes(dialog.type) && (
        <EntityForm
          entity={dialog.type === "entity-edit" ? entity : null}
          type={dialog.type === "entity-edit" ? entity.type : w.page}
          members={w.members}
          onSave={w.saveEntity}
          onCancel={closeDialog}
          notify={w.notify}
        />
      )}
      {dialog.type === "state" && (
        <StateForm
          entity={entity}
          members={w.members}
          mode={dialog.mode}
          nextState={dialog.nextState}
          onSave={w.saveState}
          onCancel={closeDialog}
          notify={w.notify}
        />
      )}
      {dialog.type === "bindings" && (
        <BindingForm
          entity={entity}
          members={w.members}
          onCancel={closeDialog}
          onSave={(owners) => w.saveState(entity.state, owners)}
          notify={w.notify}
        />
      )}
      {dialog.type === "entity-actions" && (
        <div className="action-menu">
          {locked ? (
            <Button
              icon="history"
              onClick={() =>
                w.setDialog({
                  type: "state",
                  mode: "reopen",
                  nextState: entity.lastOpenState ?? "视奸观察",
                })
              }
            >
              重新开启
            </Button>
          ) : (
            <>
              <Button
                icon="edit"
                onClick={() => w.setDialog({ type: "entity-edit" })}
              >
                编辑资料
              </Button>
              <Button
                icon="lock"
                onClick={() =>
                  w.setDialog({
                    type: "state",
                    mode: "close",
                    nextState: "已弃用",
                  })
                }
              >
                关闭档案
              </Button>
            </>
          )}
        </div>
      )}
      {dialog.type === "record-edit" && canViewRecord(dialog.record, actor) && (
        <RecordForm
          record={dialog.record}
          notify={w.notify}
          onSave={(body, images) =>
            w.changeRecord(dialog.record, "编辑", body, images)
          }
          onCancel={closeDialog}
          onOpen={(im) =>
            w.setDialog({ type: "image", image: im, record: dialog.record })
          }
        />
      )}
      {dialog.type === "record-delete" && (
        <div className="modal-form">
          <p>删除后，仅原作者和管理员可查看正文、历史与图片。记录仍可恢复。</p>
          <div className="modal-actions">
            <Button variant="quiet" onClick={closeDialog}>
              取消
            </Button>
            <Button
              variant="primary"
              onClick={() => w.changeRecord(dialog.record, "删除")}
            >
              删除记录
            </Button>
          </div>
        </div>
      )}
      {dialog.type === "history" && canViewRecord(dialog.record, actor) && (
        <div className="history-list">
          {[...dialog.record.versions].reverse().map((version, i) => (
            <article key={i}>
              <div className="history-byline">
                <strong>{version.operation}</strong>
                <span>版本 {dialog.record.versions.length - i}</span>
                <time>{version.time}</time>
              </div>
              <div className="history-actor">{w.memberName(version.actor)}</div>
              <div className="record-body">
                {version.body
                  .split("\n")
                  .filter(Boolean)
                  .map((p, i) => (
                    <p key={i}>{p}</p>
                  ))}
              </div>
              <Images
                images={version.images}
                onOpen={(im) =>
                  w.setDialog({
                    type: "image",
                    image: im,
                    record: dialog.record,
                  })
                }
              />
            </article>
          ))}
        </div>
      )}
      {dialog.type === "image" &&
        (!dialog.record || canViewRecord(dialog.record, actor)) && (
          <div className="lightbox">
            <img src={dialog.image.url} alt={dialog.image.name} />
          </div>
        )}
      {dialog.type === "profile" && (
        <div className="modal-form">
          <HunterProfile key={actor.id} actor={actor} w={w} />
          <div className="prototype-switch">
            <label>
              预览身份<small>仅用于验证原型权限</small>
            </label>
            <MemberPicker
              members={w.members}
              value={[w.actorId]}
              multiple={false}
              label="切换预览身份"
              onChange={(ids) => w.switchActor(ids[0])}
            />
          </div>
          <Button
            variant="outline"
            icon="logout"
            onClick={() => {
              w.setLoggedIn(false);
              closeDialog();
            }}
          >
            查看登录页
          </Button>
        </div>
      )}
      {["member-new", "member-edit"].includes(dialog.type) && (
        <MemberForm
          member={dialog.member}
          members={w.members}
          notify={w.notify}
          onCancel={closeDialog}
          onSave={(next) => {
            w.setMembers((p) =>
              dialog.member
                ? p.map((m) => (m.id === next.id ? next : m))
                : [...p, next],
            );
            closeDialog();
            if (next.id === w.actorId) {
              if (next.frozen) w.setLoggedIn(false);
              else if (next.role !== "admin") {
                w.setPage("person");
                w.setSelected("p1");
              }
            }
            w.notify("演示账号已保存");
          }}
        />
      )}
      {dialog.type === "protocol" && (
        <div className="protocol-text">{protocolText}</div>
      )}
    </Modal>
  );
}
function BindingForm({ entity, members, onSave, onCancel, notify }) {
  const [owners, setOwners] = useState(entity.owners[entity.state] ?? []),
    work = isWorkState(entity.type, entity.state);
  return (
    <form
      className="modal-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (work && !owners.length) {
          notify("工作状态必须选择负责成员");
          return;
        }
        onSave(owners);
      }}
    >
      <p>当前状态：{entity.state}</p>
      <MemberPicker
        members={members}
        value={owners}
        onChange={setOwners}
        label="选择绑定成员"
      />
      <p className="field-hint">
        {work
          ? "此工作状态必须绑定负责成员，可选择多人。"
          : "关联成员用于保留协作记录，可以留空。"}
      </p>
      <div className="modal-actions">
        <Button variant="quiet" type="button" onClick={onCancel}>
          取消
        </Button>
        <Button variant="primary" type="submit">
          保存成员
        </Button>
      </div>
    </form>
  );
}
function MemberForm({ member, members, onSave, onCancel, notify }) {
  const [avatar, setAvatar] = useState(member?.avatar ?? ""),
    [qqPreview, setQQPreview] = useState(member?.qq ?? "");
  return (
    <form
      className="modal-form"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.target),
          name = f.get("name").trim(),
          username = f.get("username").trim(),
          role = f.get("role"),
          frozen = f.get("frozen") === "yes",
          qq = f.get("qq").trim();
        if (!name || !username) {
          notify("名称和账号不能为空");
          return;
        }
        if (qq && !/^\d{5,12}$/.test(qq)) {
          notify("QQ 号需为 5–12 位数字");
          return;
        }
        if (
          members.some((m) => m.id !== member?.id && m.username === username)
        ) {
          notify("账号已存在");
          return;
        }
        if (
          member?.role === "admin" &&
          (frozen || role !== "admin") &&
          !members.some(
            (m) => m.id !== member.id && m.role === "admin" && !m.frozen,
          )
        ) {
          notify("须保留至少一名未冻结的管理员");
          return;
        }
        onSave({
          id: member?.id ?? uuid(),
          name,
          username,
          role,
          frozen,
          qq,
          avatar,
        });
      }}
    >
      <AvatarEditor
        label="猎头头像"
        name={member?.name}
        qq={qqPreview}
        value={avatar}
        onChange={setAvatar}
        notify={notify}
      />
      <label>
        显示名称
        <input name="name" defaultValue={member?.name ?? ""} required />
      </label>
      <label>
        账号
        <input
          name="username"
          defaultValue={member?.username ?? ""}
          required
          autoComplete="off"
        />
      </label>
      <label>
        QQ 号<small>可选，未上传头像时使用</small>
        <input
          name="qq"
          value={qqPreview}
          onChange={(e) => setQQPreview(e.target.value)}
          inputMode="numeric"
        />
      </label>
      <label>
        角色
        <select name="role" defaultValue={member?.role ?? "member"}>
          <option value="member">普通成员</option>
          <option value="admin">管理员</option>
        </select>
      </label>
      {member && (
        <label>
          账号状态
          <select name="frozen" defaultValue={member.frozen ? "yes" : "no"}>
            <option value="no">正常</option>
            <option value="yes">已冻结</option>
          </select>
        </label>
      )}
      <p className="field-hint">原型只演示管理交互，不创建真实账号或密码。</p>
      <div className="modal-actions">
        <Button variant="quiet" type="button" onClick={onCancel}>
          取消
        </Button>
        <Button variant="primary" type="submit">
          保存
        </Button>
      </div>
    </form>
  );
}

function HunterProfile({ actor, w }) {
  const [avatar, setAvatar] = useState(actor.avatar ?? ""),
    [qq, setQQ] = useState(actor.qq ?? "");
  return (
    <form
      className="hunter-profile"
      onSubmit={(event) => {
        event.preventDefault();
        const nextQQ = qq.trim();
        if (nextQQ && !/^\d{5,12}$/.test(nextQQ)) {
          w.notify("QQ 号需为 5–12 位数字");
          return;
        }
        w.setMembers((previous) =>
          previous.map((member) =>
            member.id === actor.id ? { ...member, avatar, qq: nextQQ } : member,
          ),
        );
        w.notify("猎头头像已保存");
      }}
    >
      <div className="profile-identity">
        <strong>{actor.name}</strong>
        <span>
          {actor.username} · {actor.role === "admin" ? "管理员" : "普通成员"}
        </span>
      </div>
      <AvatarEditor
        label="我的头像"
        name={actor.name}
        qq={qq.trim()}
        value={avatar}
        onChange={setAvatar}
        notify={w.notify}
      />
      <label>
        QQ 号 <small>选填</small>
        <input
          value={qq}
          onChange={(event) => setQQ(event.target.value)}
          inputMode="numeric"
        />
      </label>
      <Button type="submit" variant="primary">
        保存头像设置
      </Button>
    </form>
  );
}
