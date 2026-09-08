import React, { useState } from "react";
import { Button, ImageInput, Images, imageFiles } from "./components.jsx";
import { MemberPicker } from "./MemberPicker.jsx";
import { ContactFields } from "./ContactFields.jsx";
import { AvatarEditor } from "./AvatarEditor.jsx";
import { isWorkState, isClosed, personStates, orgStates } from "./model.js";

export function EntityForm({
  entity,
  type,
  members,
  onSave,
  onCancel,
  notify,
}) {
  const [name, setName] = useState(entity?.name ?? ""),
    [avatar, setAvatar] = useState(entity?.avatar ?? "");
  const [state, setState] = useState(entity?.state ?? "视奸观察"),
    [owners, setOwners] = useState(entity?.owners?.[entity.state] ?? []);
  const work = isWorkState(type, state);
  return (
    <form
      className="modal-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim()) {
          notify("请填写名称");
          return;
        }
        if (work && !owners.length) {
          notify("工作状态必须选择负责成员");
          return;
        }
        const data = new FormData(e.target);
        const contacts = data
          .getAll("contact-type")
          .map((type, i) => ({
            type,
            value: data.getAll("contact-value")[i].trim(),
          }))
          .filter((c) => c.value);
        const invalid = contacts.find(
          (c) => c.type === "QQ" && !/^\d{5,12}$/.test(c.value),
        );
        if (invalid) {
          notify("QQ 号需为 5–12 位数字");
          return;
        }
        onSave({ name: name.trim(), avatar, contacts, state, owners });
      }}
    >
      <AvatarEditor
        type={type}
        name={name}
        contacts={entity?.contacts}
        value={avatar}
        onChange={setAvatar}
        notify={notify}
        label={type === "org" ? "组织头像" : "人物头像"}
      />
      <label>
        {type === "org" ? "组织名称" : "人物名称"}
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={80}
          placeholder={type === "org" ? "这个组织叫什么" : "如何称呼这个人"}
          required
          autoFocus
        />
      </label>
      {!entity && (
        <label>
          业务状态
          <select
            value={state}
            onChange={(e) => {
              setState(e.target.value);
              setOwners([]);
            }}
          >
            {(type === "org" ? orgStates : personStates)
              .filter((s) => !isClosed(s))
              .map((s) => (
                <option key={s}>{s}</option>
              ))}
          </select>
        </label>
      )}
      <ContactFields initial={entity?.contacts ?? []} />
      <div className="form-field">
        <label>
          {work
            ? type === "person"
              ? "人事负责成员"
              : "工作负责成员"
            : "关联成员"}
          <small>{work ? "必选，可多人" : "可选，作为关联记录"}</small>
        </label>
        <MemberPicker
          members={members}
          value={owners}
          onChange={setOwners}
          label={work ? "选择负责成员" : "选择关联成员"}
        />
      </div>
      <div className="modal-actions">
        <Button type="button" variant="quiet" onClick={onCancel}>
          取消
        </Button>
        <Button type="submit" variant="primary">
          {entity ? "保存修改" : "创建档案"}
        </Button>
      </div>
    </form>
  );
}

export function StateForm({
  entity,
  members,
  nextState,
  mode,
  onSave,
  onCancel,
  notify,
}) {
  const [state, setState] = useState(nextState ?? entity.state),
    [owners, setOwners] = useState(
      entity.owners[nextState ?? entity.state] ?? [],
    );
  const work = isWorkState(entity.type, state);
  const choices = (entity.type === "org" ? orgStates : personStates).filter(
    (s) =>
      mode === "reopen" ? !isClosed(s) : mode === "close" ? isClosed(s) : true,
  );
  return (
    <form
      className="modal-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (work && !owners.length) {
          notify("这个工作状态必须指定负责成员");
          return;
        }
        onSave(state, owners);
      }}
    >
      <p>
        {mode === "reopen"
          ? "选择开启状态，恢复维护。"
          : mode === "close"
            ? "关闭后保留资料，重新开启后才能继续修改。"
            : "业务状态没有先后顺序，可直接选择当前情况。"}
      </p>
      <label>
        业务状态
        <select
          value={state}
          onChange={(e) => {
            setState(e.target.value);
            setOwners(entity.owners[e.target.value] ?? []);
          }}
        >
          {choices.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </label>
      {!isClosed(state) && (
        <div className="form-field">
          <label>
            {work
              ? entity.type === "person"
                ? "人事负责成员"
                : "工作负责成员"
              : "关联成员"}
            <small>{work ? "必选，可多人" : "可选"}</small>
          </label>
          <MemberPicker
            members={members}
            value={owners}
            onChange={setOwners}
            label="选择绑定成员"
          />
          {work && (
            <p className="field-hint">
              状态与负责成员一起保存，原状态的关联保留在历史中。
            </p>
          )}
        </div>
      )}
      <div className="modal-actions">
        <Button type="button" variant="quiet" onClick={onCancel}>
          取消
        </Button>
        <Button type="submit" variant="primary">
          {mode === "close"
            ? "确认关闭"
            : mode === "reopen"
              ? "重新开启"
              : "保存状态"}
        </Button>
      </div>
    </form>
  );
}

export function RecordForm({ record, onSave, onCancel, notify, onOpen }) {
  const [body, setBody] = useState(record.body),
    [images, setImages] = useState(record.images),
    [preview, setPreview] = useState(null);
  return (
    <form
      className="modal-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!body.trim() && !images.length) {
          notify("请至少保留文字或图片");
          return;
        }
        onSave(body.trim(), images);
      }}
    >
      <label>
        观察内容
        <textarea
          rows={7}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          autoFocus
        />
      </label>
      <Images
        images={images}
        onOpen={setPreview}
        onRemove={(i) => setImages((p) => p.filter((_, n) => n !== i))}
      />
      <ImageInput
        onFiles={(files) =>
          setImages((p) => [...p, ...imageFiles(files, notify)].slice(0, 10))
        }
      />
      {preview && (
        <div className="inline-image-preview">
          <Button
            type="button"
            variant="quiet"
            onClick={() => setPreview(null)}
          >
            收起图片
          </Button>
          <img src={preview.url} alt={preview.name} />
        </div>
      )}
      <p className="field-hint">
        修改会保存新版本，旧正文和旧图片仍保留在历史中。
      </p>
      <div className="modal-actions">
        <Button type="button" variant="quiet" onClick={onCancel}>
          取消
        </Button>
        <Button type="submit" variant="primary">
          保存修改
        </Button>
      </div>
    </form>
  );
}
