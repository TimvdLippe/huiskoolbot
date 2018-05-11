import * as TelegrafTypes from 'telegraf'
import * as path from 'path';
import { CronJob } from 'cron';

const Telegraf = require('telegraf') as typeof TelegrafTypes.Telegraf;

interface Config {
  botToken?: string;
  members?: Member[];
}

interface Member {
  username?: string;
}

interface MemberInfo {
  username: string;
  weeksSince: number;
}

const CONFIG_PARAMETER = '--config=';
const TIMEZONE = 'Europe/Amsterdam';
const CALLBACK_FREQUENCY = '00 00 17 * * 1'; // Every monday at 17:00
const DEBUG_CALLBACK_FREQUENCY = '*/10 * * * * *'; // Every 10 seconds

let fileLocation;

for (const arg of process.argv) {
  if (arg.startsWith(CONFIG_PARAMETER)) {
    fileLocation = arg.substring(CONFIG_PARAMETER.length);
  }
}

if (!fileLocation) {
  throw new Error(`Run the bot with "--config=<location to config file>"`);
}

const configLocation = path.resolve(process.cwd(), fileLocation);
const config: Config = require(configLocation);

if (!config.botToken) {
  throw new Error(`Field "botToken" does not exist in config "${configLocation}"`);
}

if (!config.members) {
  throw new Error(`Field "members" does not exist in config "${configLocation}"`);
}

const sinceMapping: MemberInfo[] = [];

for (const member of config.members) {
  if (!member.username) {
    throw new Error(`Member does not have field "username" in "${JSON.stringify(member)}"`);
  }
  sinceMapping.push({
    username: member.username,
    weeksSince: 0
  });
}

let state: {
  searching: boolean,
  triedToHostAt: Set<string>
} = resetState();

function resetState() {
  return {
    searching: false,
    triedToHostAt: new Set()
  };
}

function getLongestSince() {
  return sinceMapping
        .filter(member => !state.triedToHostAt.has(member.username))
        .reduce((previousValue, currentValue) => {
          if (previousValue.weeksSince > currentValue.weeksSince) {
            return previousValue;
          }
          return currentValue;
        });
}

const YES_I_CAN = 'Yes I can host the group';
const NO_I_CAN_NOT = 'No I can not host this week';

function sendMessageToLongestSince(ctx: TelegrafTypes.ContextMessageUpdate) {
  const longestSince = getLongestSince();

  ctx.reply(`This week it is supposed to be at @${longestSince.username}. Is that possible?`, {
    reply_markup: {
      keyboard: [[{text: YES_I_CAN}, {text: NO_I_CAN_NOT}]],
      one_time_keyboard: true,
      resize_keyboard: true
    }
  });

  state.searching = true;
}

function updateMemberCounts(longestSince: MemberInfo) {
  for (const member of sinceMapping) {
    if (member === longestSince) {
      member.weeksSince = 0;
    } else {
      member.weeksSince++;
    }
  }
};

function processYes(ctx: TelegrafTypes.ContextMessageUpdate) {
  if (!state.searching) {
    return ctx.reply('Oh you are trying to be smart. Yeahh no.');
  }

  const longestSince = getLongestSince();

  if (ctx.message!.from!.username === longestSince.username) {
    ctx.reply(`Location selected! This week is hosted by @${longestSince.username}`, {
      reply_markup: {
        remove_keyboard: true
      }
    });
    updateMemberCounts(longestSince);
    state = resetState();
  }
}

function processNo(ctx: TelegrafTypes.ContextMessageUpdate) {
  if (!state.searching) {
    return ctx.reply('Oh you are trying to be smart. Yeahh no.');
  }

  const longestSince = getLongestSince();

  if (ctx.message!.from!.username === longestSince.username) {
    state.triedToHostAt.add(ctx.message!.from!.username!);
    sendMessageToLongestSince(ctx);
  }
}

const bot = new Telegraf(config.botToken);

bot.start((ctx) => {
  new CronJob(CALLBACK_FREQUENCY, () => {
    // Only necessary for debugging
    if (!state.searching) {
      sendMessageToLongestSince(ctx)
    }
  }, undefined, true, TIMEZONE);
});

bot.hears(YES_I_CAN, processYes);
bot.hears(NO_I_CAN_NOT, processNo);

bot.startPolling();
