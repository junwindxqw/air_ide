// 首次启动引导状态（P5-4）：localStorage 持久化，与 DefenderHint 的「不再提示」同一做法。
// 完成后二次启动不再自动展示引导；欢迎页（无工作区时）仍保留打开项目入口。
export const ONBOARDING_DONE_KEY = 'air.onboardingDone'

export function isOnboardingDone(): boolean {
  return localStorage.getItem(ONBOARDING_DONE_KEY) === '1'
}

export function markOnboardingDone(): void {
  localStorage.setItem(ONBOARDING_DONE_KEY, '1')
}
