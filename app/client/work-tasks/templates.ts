import { memberMonthlyCopy } from '../../rules/member-monthly-follow-up';
import { deliveryDefault } from './presentation';

export const templateNames = {custom: '临时工作', onboarding: '工作对接', monthly: '月度沟通', followup: '联系跟进'};
export type TaskTemplate = keyof typeof templateNames;

export function taskTemplate(type: TaskTemplate, name = '') {
  const subject = name ? name + '的' : '';
  switch (type) {
    case 'onboarding': return {
      title: subject + '工作对接',
      purpose: '协助加入提瓦特群、菠萝群和飞书，安排参会，并跟进具体小组或项目的工作。有学习 AI 意愿时，可介绍去草台班子。',
      delivery: '在人物档案中记录实际加入的小组或项目，以及已经开始做的具体工作。如果目前只完成进群、加入飞书或参会，记录进展和下一步，继续跟进。'
    };
    case 'monthly': return {title: subject + '月度沟通', ...memberMonthlyCopy};
    case 'followup': return {title: '联系跟进', purpose: '了解近期情况并新增观察，更新本次联系结果。', delivery: deliveryDefault};
    case 'custom': return {title: '临时工作', purpose: '', delivery: deliveryDefault};
  }
}
