const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const cron = require('node-cron');
const { exec } = require('child_process');
const { existsSync } = require('fs');
const path = require('path');

const app = express();
const PORT = 3000;

app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

const scheduledTasks = new Map();
const taskHistory = new Map();

const browsers = {
  chrome: {
    name: 'Google Chrome',
    winExecutable: 'chrome.exe',
    winPaths: [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`
    ],
    macApp: 'Google Chrome',
    linuxCommand: 'google-chrome'
  },
  edge: {
    name: 'Microsoft Edge',
    winExecutable: 'msedge.exe',
    winPaths: [
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
    ],
    macApp: 'Microsoft Edge',
    linuxCommand: 'microsoft-edge'
  },
  firefox: {
    name: 'Mozilla Firefox',
    winExecutable: 'firefox.exe',
    winPaths: [
      'C:\\Program Files\\Mozilla Firefox\\firefox.exe',
      'C:\\Program Files (x86)\\Mozilla Firefox\\firefox.exe'
    ],
    macApp: 'Firefox',
    linuxCommand: 'firefox'
  },
  '360': {
    name: '360安全浏览器',
    winExecutable: '360se.exe',
    winPaths: [
      'C:\\Program Files\\360\\360se6\\Application\\360se.exe',
      'C:\\Program Files (x86)\\360\\360se6\\Application\\360se.exe',
      `${process.env.LOCALAPPDATA}\\360Chrome\\Chrome\\Application\\360chrome.exe`
    ]
  }
};

function getBrowserCommand(browserKey, url) {
  const platform = process.platform;
  
  if (browserKey === 'default') {
    if (platform === 'win32') {
      return `start "" "${url}"`;
    } else if (platform === 'darwin') {
      return `open "${url}"`;
    } else {
      return `xdg-open "${url}"`;
    }
  }

  const browser = browsers[browserKey];
  if (!browser) {
    return null;
  }

  if (platform === 'win32') {
    if (browser.winPaths) {
      for (const winPath of browser.winPaths) {
        if (existsSync(winPath)) {
          return `start "" "${winPath}" "${url}"`;
        }
      }
    }
    
    return `start "" "${browser.winExecutable}" "${url}"`;
  } else if (platform === 'darwin') {
    if (browser.macApp) {
      return `open -a "${browser.macApp}" "${url}"`;
    }
  } else {
    if (browser.linuxCommand) {
      return `${browser.linuxCommand} "${url}"`;
    }
  }
  
  return null;
}

function openUrl(browserKey, url) {
  const command = getBrowserCommand(browserKey, url);
  
  if (!command) {
    const errorMsg = `无法找到浏览器命令: ${browsers[browserKey]?.name || browserKey}`;
    console.error(errorMsg);
    return { success: false, message: errorMsg };
  }

  console.log(`执行命令: ${command}`);
  
  exec(command, { shell: 'cmd.exe' }, (error, stdout, stderr) => {
    if (error) {
      console.error(`执行命令失败: ${error.message}`);
      console.error(`错误输出: ${stderr}`);
    } else {
      console.log(`命令执行成功: ${stdout || '无输出'}`);
    }
  });

  return { success: true, message: `已尝试打开: ${url}` };
}

function createCronExpression(scheduleRule) {
  if (!scheduleRule || !scheduleRule.months || !scheduleRule.days || 
      !scheduleRule.hours || !scheduleRule.minutes) {
    return null;
  }

  const { months, days, hours, minutes } = scheduleRule;

  let minutePart = '*';
  let hourPart = '*';
  let dayPart = '*';
  let monthPart = '*';
  const dayOfWeek = '*';

  if (minutes.length === 60) {
    minutePart = '*';
  } else if (minutes.length > 0) {
    minutePart = minutes.join(',');
  }

  if (hours.length === 24) {
    hourPart = '*';
  } else if (hours.length > 0) {
    hourPart = hours.join(',');
  }

  if (days.length >= 28) {
    dayPart = '*';
  } else if (days.length > 0) {
    dayPart = days.join(',');
  }

  if (months.length === 12) {
    monthPart = '*';
  } else if (months.length > 0) {
    monthPart = months.join(',');
  }

  return `${minutePart} ${hourPart} ${dayPart} ${monthPart} ${dayOfWeek}`;
}

function isRecurringTask(scheduleRule) {
  if (!scheduleRule) return false;
  
  const { months, days, hours, minutes } = scheduleRule;
  
  return months.length > 1 || days.length > 1 || hours.length > 1 || minutes.length > 1 ||
         months.length === 12 || days.length >= 28 || hours.length === 24 || minutes.length === 60;
}

function formatRuleDisplay(scheduleRule) {
  if (!scheduleRule) return '';
  
  const { year, months, days, hours, minutes } = scheduleRule;
  let result = '';

  if (months.length === 12) {
    result += '每年';
  } else {
    result += `${year}年`;
    if (months.length <= 5) {
      result += months.map(m => m + '月').join('、');
    } else {
      result += `共${months.length}个月`;
    }
  }

  if (days.length >= 28) {
    result += '每月';
  } else {
    if (days.length <= 5) {
      result += days.map(d => d + '日').join('、');
    } else {
      result += `共${days.length}天`;
    }
  }

  if (hours.length === 24) {
    result += '每日';
  } else {
    if (hours.length <= 5) {
      result += hours.map(h => String(h).padStart(2, '0') + '时').join('、');
    } else {
      result += `共${hours.length}个小时`;
    }
  }

  if (minutes.length === 60) {
    result += '每小时';
  } else {
    if (minutes.length <= 5) {
      result += minutes.map(m => String(m).padStart(2, '0') + '分').join('、');
    } else {
      result += `共${minutes.length}分钟`;
    }
  }

  result += '执行';
  return result;
}

app.get('/api/browsers', (req, res) => {
  const availableBrowsers = [{ key: 'default', name: '系统默认浏览器' }];
  
  for (const [key, browser] of Object.entries(browsers)) {
    availableBrowsers.push({ key, name: browser.name });
  }
  
  res.json({ success: true, browsers: availableBrowsers });
});

app.get('/api/tasks', (req, res) => {
  const tasks = [];
  
  for (const [id, task] of scheduledTasks.entries()) {
    tasks.push({
      id,
      browser: task.browser,
      url: task.url,
      scheduledTime: task.scheduledTime,
      createdAt: task.createdAt,
      status: 'pending',
      scheduleRule: task.scheduleRule,
      isRecurring: task.isRecurring,
      ruleDisplay: task.ruleDisplay,
      lastExecutedAt: task.lastExecutedAt
    });
  }
  
  for (const [id, task] of taskHistory.entries()) {
    tasks.push({
      id,
      browser: task.browser,
      url: task.url,
      scheduledTime: task.scheduledTime,
      createdAt: task.createdAt,
      executedAt: task.executedAt,
      status: task.status,
      scheduleRule: task.scheduleRule,
      isRecurring: task.isRecurring,
      ruleDisplay: task.ruleDisplay,
      lastExecutedAt: task.lastExecutedAt
    });
  }
  
  tasks.sort((a, b) => {
    if (a.status === 'pending' && b.status !== 'pending') return -1;
    if (a.status !== 'pending' && b.status === 'pending') return 1;
    
    if (a.status === 'pending') {
      return new Date(a.scheduledTime) - new Date(b.scheduledTime);
    } else {
      return new Date(b.executedAt || b.createdAt) - new Date(a.executedAt || a.createdAt);
    }
  });
  
  res.json({ success: true, tasks });
});

app.post('/api/schedule', (req, res) => {
  try {
    const { browser, url, scheduledTime, scheduleRule } = req.body;
    console.log('收到创建任务请求:', { browser, url, scheduledTime, scheduleRule });

    if (!browser || !url || !scheduledTime) {
      return res.status(400).json({ success: false, message: '缺少必要参数' });
    }

    const scheduledDate = new Date(scheduledTime);
    const now = new Date();
    
    if (scheduledDate <= now) {
      return res.status(400).json({ success: false, message: '定时时间必须大于当前时间' });
    }

    const taskId = Date.now().toString();
    
    let cronExpression;
    let isRecurring = false;
    let ruleDisplay = '';
    
    if (scheduleRule) {
      cronExpression = createCronExpression(scheduleRule);
      isRecurring = isRecurringTask(scheduleRule);
      ruleDisplay = formatRuleDisplay(scheduleRule);
    } else {
      const date = new Date(scheduledTime);
      if (isNaN(date.getTime())) {
        return res.status(400).json({ success: false, message: '时间格式无效' });
      }
      const minute = date.getMinutes();
      const hour = date.getHours();
      const day = date.getDate();
      const month = date.getMonth() + 1;
      cronExpression = `${minute} ${hour} ${day} ${month} *`;
    }
    
    console.log('生成的 cron 表达式:', cronExpression);
    console.log('是否循环任务:', isRecurring);

    if (!cronExpression) {
      return res.status(400).json({ success: false, message: '时间格式无效' });
    }

    const task = cron.schedule(cronExpression, () => {
      console.log(`执行定时任务: ${taskId}`);
      openUrl(browser, url);
      
      const executedTask = scheduledTasks.get(taskId);
      if (executedTask) {
        if (executedTask.isRecurring) {
          executedTask.lastExecutedAt = new Date().toISOString();
          console.log(`循环任务已执行，下次继续等待: ${taskId}`);
        } else {
          executedTask.status = 'executed';
          executedTask.executedAt = new Date().toISOString();
          taskHistory.set(taskId, executedTask);
          scheduledTasks.delete(taskId);
        }
      }
    });

    scheduledTasks.set(taskId, {
      id: taskId,
      browser,
      url,
      scheduledTime,
      scheduleRule: scheduleRule || null,
      isRecurring: isRecurring,
      ruleDisplay: ruleDisplay,
      createdAt: new Date().toISOString(),
      cronTask: task
    });

    console.log('定时任务创建成功:', taskId);
    res.json({ 
      success: true, 
      message: '定时任务创建成功',
      task: {
        id: taskId,
        browser,
        url,
        scheduledTime,
        scheduleRule,
        isRecurring,
        ruleDisplay
      }
    });
  } catch (error) {
    console.error('创建定时任务失败:', error);
    res.status(500).json({ 
      success: false, 
      message: '创建任务失败: ' + error.message 
    });
  }
});

app.delete('/api/tasks/:id', (req, res) => {
  const taskId = req.params.id;
  
  if (!scheduledTasks.has(taskId)) {
    return res.status(404).json({ success: false, message: '任务不存在' });
  }

  const task = scheduledTasks.get(taskId);
  task.cronTask.stop();
  
  task.status = 'cancelled';
  task.cancelledAt = new Date().toISOString();
  taskHistory.set(taskId, task);
  scheduledTasks.delete(taskId);

  res.json({ success: true, message: '任务已取消' });
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`服务运行在 http://localhost:${PORT}`);
});
