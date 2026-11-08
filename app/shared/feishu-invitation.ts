// Replace the image and its real expiry together; never extend an old QR code automatically.
export const feishuInvitation:{imageSrc:string|null;expiresAt:string;frame?:{width:number;height:number;viewBox:string}}={
 imageSrc:'/art/feishu-invitation-2026-12-20.jpeg',
 frame:{width:1080,height:1920,viewBox:'300 880 480 480'},
 expiresAt:'2026-12-21T00:00:00+08:00',
};
export function feishuInvitationExpired(at:number,expiresAt=feishuInvitation.expiresAt){
 const deadline=Date.parse(expiresAt);return !Number.isFinite(deadline)||at>=deadline;
}
export type MembershipResult={membership_joined?:boolean};
