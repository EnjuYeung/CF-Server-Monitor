// 详情页实时状态的时间含义：last_updated 与 REST 同义，是主控接收时间，决定「最后更新」和在线状态；
// sample_timestamp 是采样时间，决定图表位置；timestamp 是浏览器显示这个状态的时间。
export const buildLiveStatusData = (event, reportTs, displayTs = Date.now()) => ({
  ...event.data,
  sample_timestamp: event.ts,
  last_updated: reportTs,
  timestamp: displayTs
})

export const getLiveChartTime = (data) => new Date(data.sample_timestamp || data.last_updated).getTime()
