# 六位 DeepSeek 娘登录主视觉（#147）

用户授权以出拳表情包为构图参考，角色使用随后补充的 DeepSeek 娘图片。中央一位、周围五位，恰好六位；保留大眼睛、鲸鱼发夹、卷曲呆毛及蓝白女仆装，不添加原图文案。

正式站和原型复用 `app/ui/LoginScene.tsx`。桌面延续左右布局，850px 及以下改为完整主视觉在上、表单在下；移除旧手机端绝对定位对新插画的影响。图片不参与主题混色，手机主题按钮在白色画布上保持深色。

资源：

- 原图：[PNG](../design/assets/login-whale-six-v1.png)，1254 × 1254。
- 上线：[WebP](../../public/art/login-whale-six-v1.webp)，289,014 字节。
- 工具：内置 image_gen；[最终提示词](../design/assets/login-whale-six-v1.prompt.txt)。

验证通过：

- `tsc --noEmit` 与 `vite build`。
- `node scripts/check-ui.mjs`：历史原型与正式站 1920、1440、1024、390px 对照，以及完整编辑、观察发布、头像与图片查看回归。
- `node --experimental-transform-types scripts/verify-work-overview.mjs`：隔离 SQLite 与真实 HTTP 登录、桌面/手机编辑发布、主题切换及共享原型。
- 独立无头浏览器检查生产产物的 1440、850、390、320px × 日夜共八种情况：图片成功加载、完整包含、无横向溢出，手机主视觉与表单不重叠，账号密码及登录按钮可用。逐一检查截图，修正旧手机绝对定位后重验。

截图：

- [桌面 1440px](screenshots/whale-hero/desktop-1440.png)
- [手机 390px](screenshots/whale-hero/mobile-390.png)
- [深夜手机 390px](screenshots/whale-hero/night-mobile-390.png)

可交互浏览器预览连接不可用；上述视觉检查使用项目独立测试浏览器与截图完成。
