// Fictional prototype fixtures. No real account or archive data.
export const personStates = [
  "视奸观察",
  "个人接触",
  "引荐中（待人事组接触）",
  "人事审核",
  "已加入待对接",
  "已入伙",
  "已弃用",
];
export const orgStates = ["视奸观察", "个人接触", "组织交流", "已弃用"];
export const personWorkStates = [
  "引荐中（待人事组接触）",
  "人事审核",
  "已加入待对接",
];
export const isWorkState = (type, state) =>
  type === "org" ? state === "组织交流" : personWorkStates.includes(state);
export const isClosed = (state) => ["已入伙", "已弃用"].includes(state);
export const uuid = () => crypto.randomUUID();
export const stamp = () =>
  new Date()
    .toLocaleString("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })
    .replaceAll("/", "-");
export const canViewRecord = (record, actor) =>
  !record.deleted || record.author === actor.id || actor.role === "admin";
export const canEditRecord = (record, actor) =>
  record.author === actor.id || actor.role === "admin";
export const initialMembers = [
  {
    id: "zhou",
    name: "周宁",
    username: "zhouning",
    role: "admin",
    frozen: false,
  },
  {
    id: "shen",
    name: "沈舟",
    username: "shenzhou",
    role: "member",
    frozen: false,
  },
  { id: "xu", name: "许禾", username: "xuhe", role: "member", frozen: true },
  ...[
    ["he", "何其", "heqi"],
    ["jiang", "江远", "jiangyuan"],
    ["qiao", "乔木", "qiaomu"],
    ["li", "李岸", "lian"],
    ["chen", "陈墨", "chenmo"],
    ["song", "宋遥", "songyao"],
    ["xia", "夏知", "xiazhi"],
    ["lin", "林屿", "linyu"],
    ["lu", "陆青", "luqing"],
    ["bai", "白杨", "baiyang"],
    ["wen", "温语", "wenyu"],
    ["han", "韩序", "hanxu"],
    ["zheng", "郑舟", "zhengzhou"],
  ].map(([id, name, username]) => ({
    id,
    name,
    username,
    role: "member",
    frozen: false,
  })),
];
const record = (id, author, time, body, extra = {}) => ({
  id,
  author,
  time,
  body,
  images: [],
  deleted: false,
  isNew: false,
  versions: [{ body, time, actor: author, operation: "创建", images: [] }],
  ...extra,
});
export const initialEntities = [
  {
    id: "p1",
    type: "person",
    name: "林川",
    state: "人事审核",
    owners: {
      个人接触: ["zhou"],
      "引荐中（待人事组接触）": ["zhou"],
      人事审核: ["shen", "he"],
    },
    contacts: [{ type: "微信", value: "linchuan_demo" }],
    updated: "09-07 14:32",
    records: [
      record(
        "r1",
        "shen",
        "09-07 14:32",
        "聊了最近一次社区活动的协作。林川把内容准备、现场分工和后续复盘讲得很具体，也能坦诚地说明自己没有处理好的地方。\n\n想再一起做一次小型活动。比起继续问过往经历，具体合作应该能帮助我们了解彼此。",
        { isNew: true },
      ),
      record(
        "r2",
        "zhou",
        "09-06 16:48",
        "初步沟通了过往的内容策划经历。对社区协作有自己的理解，愿意承担具体事务。\n\n已引荐给人事组，后续由当前负责成员继续了解。",
      ),
      record(
        "r-deleted-own",
        "zhou",
        "09-05 12:10",
        "虚构的已删除内容：这条记录属于周宁，只有原作者和管理员能看到。",
        { deleted: true },
      ),
      record(
        "r-deleted-other",
        "he",
        "09-05 11:50",
        "虚构的受限内容：这条记录属于何其，非作者的普通成员不应看到。",
        { deleted: true },
      ),
    ],
    events: [
      {
        id: "ev1",
        kind: "system",
        actor: "zhou",
        time: "09-07 09:20",
        text: "业务状态改为「人事审核」，人事负责成员为沈舟、何其",
        isNew: true,
      },
    ],
  },
  {
    id: "p2",
    type: "person",
    name: "叶宁",
    state: "视奸观察",
    owners: {},
    contacts: [],
    updated: "09-07 11:08",
    records: [
      record(
        "r3",
        "shen",
        "09-07 11:08",
        "最近的社区影像记录很有意思，对细节敏感，也愿意分享素材整理的方法。继续观察。",
        { isNew: true },
      ),
    ],
    events: [],
  },
  {
    id: "p3",
    type: "person",
    name: "周野",
    state: "引荐中（待人事组接触）",
    owners: { "引荐中（待人事组接触）": ["zhou"] },
    contacts: [],
    updated: "09-06 18:20",
    records: [
      record(
        "r4",
        "shen",
        "09-06 18:20",
        "已经引荐给人事组。此前合作中响应及时，可以进一步了解对长期协作的预期。",
        { isNew: true },
      ),
    ],
    events: [],
  },
  {
    id: "p4",
    type: "person",
    name: "陈榆",
    state: "个人接触",
    owners: { 个人接触: ["shen"] },
    contacts: [],
    updated: "09-06 16:12",
    records: [
      record(
        "r5",
        "shen",
        "09-06 16:12",
        "有持续学习的投入，也能具体描述自己的不足。约定下次聊一聊最近在做的内容。",
      ),
    ],
    events: [],
  },
  {
    id: "p5",
    type: "person",
    name: "陆遥",
    state: "已弃用",
    lastOpenState: "个人接触",
    owners: { 个人接触: ["zhou"] },
    contacts: [],
    updated: "09-05 09:40",
    records: [
      record(
        "r6",
        "zhou",
        "09-05 09:40",
        "当前方向不匹配，暂不考虑后续协作。保留此前交流记录。",
      ),
    ],
    events: [],
  },
  {
    id: "o1",
    type: "org",
    name: "北岸公共空间",
    state: "组织交流",
    owners: { 组织交流: ["zhou", "shen"] },
    contacts: [{ type: "邮箱", value: "hello@example.org" }],
    updated: "09-07 10:06",
    records: [
      record(
        "r7",
        "shen",
        "09-07 10:06",
        "交流了共同举办小型讨论的可能性。空间可以支持活动，需要进一步确认场地时间与参与方式。\n\n附上一张虚构的活动分工草图，演示图文记录。",
        { isNew: true },
      ),
    ],
    events: [],
  },
  {
    id: "o2",
    type: "org",
    name: "微光写作小组",
    state: "视奸观察",
    owners: {},
    contacts: [],
    updated: "09-06 15:40",
    records: [
      record(
        "r8",
        "zhou",
        "09-06 15:40",
        "最近几篇文章有不少具体观察。先持续阅读，了解他们正在讨论什么。",
      ),
    ],
    events: [],
  },
];
const image = { url: "/fixture-activity.svg", name: "虚构活动分工草图" };
const example = initialEntities.find((e) => e.id === "o1").records[0];
example.images = [image];
example.versions[0].images = [image];
const deletedExample = initialEntities[0].records.find(
  (r) => r.id === "r-deleted-other",
);
deletedExample.images = [{ ...image, name: "受限的虚构附件" }];
deletedExample.versions[0].images = deletedExample.images;
export function timelineOrder(item) {
  if (item.order) return item.order;
  const d = new Date();
  const [date, time] = item.time.split(" ");
  const [m, day] = date.split("-").map(Number);
  const [h, min] = time.split(":").map(Number);
  d.setMonth(m - 1, day);
  d.setHours(h, min, 0, 0);
  return +d;
}
export function itemKey(entityId, item) {
  return `${entityId}:${item.id}:${item.kind === "system" ? 1 : item.versions.length}`;
}
export function updateActor(item) {
  return item.kind === "system" ? item.actor : item.versions.at(-1).actor;
}
