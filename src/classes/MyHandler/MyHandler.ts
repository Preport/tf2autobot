import SKU from 'tf2-sku-2';
import request from 'request-retry-dayjs';
import { EClanRelationship, EFriendRelationship, EPersonaState, EResult } from 'steam-user';
import TradeOfferManager, {
    TradeOffer,
    PollData,
    CustomError,
    ItemsDict,
    Meta,
    WrongAboutOffer,
    Prices,
    Items
} from '@tf2autobot/tradeoffer-manager';

import pluralize from 'pluralize';
import SteamID from 'steamid';
import Currencies from 'tf2-currencies-2';
import async from 'async';
import dayjs from 'dayjs';
import { UnknownDictionary } from '../../types/common';

import { accepted, declined, cancelled, acceptEscrow, invalid } from './offer/notify/export-notify';
import { processAccepted, updateListings, PriceCheckQueue } from './offer/accepted/exportAccepted';
import { sendReview } from './offer/review/export-review';
import { keepMetalSupply, craftDuplicateWeapons, craftClassWeapons } from './utils/export-utils';

import { BPTFGetUserInfo } from './interfaces';

import Handler from '../Handler';
import Bot from '../Bot';
import { Entry, EntryData } from '../Pricelist';
import Commands from '../Commands/Commands';
import CartQueue from '../Carts/CartQueue';
import Inventory from '../Inventory';
import TF2Inventory from '../TF2Inventory';
import Autokeys from '../Autokeys/Autokeys';

import { Paths } from '../../resources/paths';
import log from '../../lib/logger';
import * as files from '../../lib/files';
import { exponentialBackoff } from '../../lib/helpers';

import { noiseMakers } from '../../lib/data';
import { sendAlert, sendStats } from '../../lib/DiscordWebhook/export';
import { summarize, uptime, getHighValueItems, testSKU } from '../../lib/tools/export';

import genPaths from '../../resources/paths';
import Pricer, { RequestCheckFn } from '../Pricer';
import Options from '../Options';

const filterReasons = (reasons: string[]) => {
    const filtered = new Set(reasons);
    return [...filtered];
};

export default class MyHandler extends Handler {
    readonly commands: Commands;

    readonly autokeys: Autokeys;

    readonly cartQueue: CartQueue;

    private groupsStore: string[];

    private requestCheck: RequestCheckFn;

    private get opt(): Options {
        return this.bot.options;
    }

    private get groups(): string[] {
        if (this.groupsStore === undefined) {
            const groups = this.opt.groups;

            if (groups !== null && Array.isArray(groups)) {
                groups.forEach(groupID64 => {
                    if (!new SteamID(groupID64).isValid()) {
                        throw new Error(`Invalid group SteamID64 "${groupID64}"`);
                    }
                });

                this.groupsStore = groups;
                return groups;
            }
        } else {
            return this.groupsStore;
        }
    }

    private friendsToKeepStore: string[];

    get friendsToKeep(): string[] {
        if (this.friendsToKeepStore === undefined) {
            const friendsToKeep = this.opt.keep.concat(this.bot.getAdmins.map(steamID => steamID.getSteamID64()));

            if (friendsToKeep !== null && Array.isArray(friendsToKeep)) {
                friendsToKeep.forEach(steamID64 => {
                    if (!new SteamID(steamID64).isValid()) {
                        throw new Error(`Invalid SteamID64 "${steamID64}"`);
                    }
                });

                this.friendsToKeepStore = friendsToKeep;
                return friendsToKeep;
            }
        } else {
            return this.friendsToKeepStore;
        }
    }

    private get minimumScrap(): number {
        return this.opt.crafting.metals.minScrap;
    }

    private get minimumReclaimed(): number {
        return this.opt.crafting.metals.minRec;
    }

    private get combineThreshold(): number {
        return this.opt.crafting.metals.threshold;
    }

    get dupeCheckEnabled(): boolean {
        return this.opt.offerReceived.duped.enableCheck;
    }

    get minimumKeysDupeCheck(): number {
        return this.opt.offerReceived.duped.minKeys;
    }

    private get isPriceUpdateWebhook(): boolean {
        return this.opt.discordWebhook.priceUpdate.enable && this.opt.discordWebhook.priceUpdate.url !== '';
    }

    get isWeaponsAsCurrency(): { enable: boolean; withUncraft: boolean } {
        return {
            enable: this.opt.miscSettings.weaponsAsCurrency.enable,
            withUncraft: this.opt.miscSettings.weaponsAsCurrency.withUncraft
        };
    }

    private get isAutoRelistEnabled(): boolean {
        return this.opt.miscSettings.autobump.enable;
    }

    private get invalidValueException(): number {
        return Currencies.toScrap(this.opt.offerReceived.invalidValue.exceptionValue.valueInRef);
    }

    private hasInvalidValueException = false;

    private get sendStatsEnabled(): boolean {
        return this.opt.statistics.sendStats.enable;
    }

    private isTradingKeys = false;

    get customGameName(): string {
        const customGameName = this.opt.miscSettings.game.customName;

        if (customGameName === '' || customGameName === 'TF2Autobot') {
            return `TF2Autobot v${process.env.BOT_VERSION}`;
        } else {
            return customGameName;
        }
    }

    private isPremium = false;

    private botName = '';

    private botAvatarURL = '';

    private botSteamID: SteamID;

    get getBotInfo(): BotInfo {
        return { name: this.botName, avatarURL: this.botAvatarURL, steamID: this.botSteamID, premium: this.isPremium };
    }

    recentlySentMessage: UnknownDictionary<number> = {};

    private sentSummary: UnknownDictionary<boolean> = {};

    private resetSentSummaryTimeout: NodeJS.Timeout;

    private paths: Paths;

    private isUpdating = false;

    set isUpdatingStatus(setStatus: boolean) {
        this.isUpdating = setStatus;
    }

    private retryRequest: NodeJS.Timeout;

    private poller: NodeJS.Timeout;

    private refreshTimeout: NodeJS.Timeout;

    private sendStatsInterval: NodeJS.Timeout;

    private classWeaponsTimeout: NodeJS.Timeout;

    private autoRefreshListingsInterval: NodeJS.Timeout;

    private alreadyExecutedRefreshlist = false;

    set isRecentlyExecuteRefreshlistCommand(setExecuted: boolean) {
        this.alreadyExecutedRefreshlist = setExecuted;
    }

    private executedDelayTime = 30 * 60 * 1000;

    set setRefreshlistExecutedDelay(delay: number) {
        this.executedDelayTime = delay;
    }

    constructor(public bot: Bot, private priceSource: Pricer) {
        super(bot);

        this.commands = new Commands(bot, priceSource);
        this.cartQueue = new CartQueue(bot);
        this.autokeys = new Autokeys(bot);

        this.paths = genPaths(this.opt.steamAccountName);
        this.requestCheck = this.priceSource.requestCheck.bind(this.priceSource);

        PriceCheckQueue.setBot(this.bot);
        PriceCheckQueue.setRequestCheckFn(this.requestCheck);
    }

    onRun(): Promise<OnRun> {
        this.poller = setInterval(() => {
            this.recentlySentMessage = {};
        }, 1000);

        return Promise.all([
            files.readFile(this.paths.files.loginKey, false),
            files.readFile(this.paths.files.pricelist, true),
            files.readFile(this.paths.files.loginAttempts, true),
            files.readFile(this.paths.files.pollData, true)
        ]).then(([loginKey, pricelist, loginAttempts, pollData]: [string, Entry[], number[], PollData]) => {
            return { loginKey, pricelist, loginAttempts, pollData };
        });
    }

    onReady(): void {
        log.info(
            `TF2Autobot v${process.env.BOT_VERSION} is ready | ${pluralize(
                'item',
                this.bot.pricelist.getLength,
                true
            )} in pricelist | Listings cap: ${String(
                this.bot.listingManager.cap
            )} | Startup time: ${process.uptime().toFixed(0)} s`
        );

        this.bot.client.gamesPlayed(this.opt.miscSettings.game.playOnlyTF2 ? 440 : [this.customGameName, 440]);
        this.bot.client.setPersona(EPersonaState.Online);

        this.botSteamID = this.bot.client.steamID;

        // Get Premium info from backpack.tf
        void this.getBPTFAccountInfo();

        // Smelt / combine metal if needed
        keepMetalSupply(this.bot, this.minimumScrap, this.minimumReclaimed, this.combineThreshold);

        // Craft duplicate weapons
        void craftDuplicateWeapons(this.bot);

        // Craft class weapons
        this.classWeaponsTimeout = setTimeout(() => {
            // called after 5 seconds to craft metals and duplicated weapons first.
            void craftClassWeapons(this.bot);
        }, 5 * 1000);

        // Auto sell and buy keys if ref < minimum
        this.autokeys.check();

        // Sort the inventory after crafting / combining metal
        this.sortInventory();

        // Check friend requests that we got while offline
        this.checkFriendRequests();

        // Check group invites that we got while offline
        this.checkGroupInvites();

        // Set up autorelist if enabled in environment variable
        this.bot.listings.setupAutorelist();

        // Initialize send stats
        this.sendStats();

        // Check for missing listings every 30 minutes, initiate setInterval 5 minutes after start
        this.refreshTimeout = setTimeout(() => {
            this.enableAutoRefreshListings();
        }, 5 * 60 * 1000);

        // Send notification to admin/Discord Webhook if there's any item failed to go through updateOldPrices
        const failedToUpdateOldPrices = this.bot.pricelist.failedUpdateOldPrices;

        if (failedToUpdateOldPrices.length > 0) {
            const dw = this.opt.discordWebhook.sendAlert;
            const isDwEnabled = dw.enable && dw.url !== '';

            if (this.opt.sendAlert.enable && this.opt.sendAlert.failedToUpdateOldPrices) {
                if (isDwEnabled) {
                    sendAlert('failedToUpdateOldPrices', this.bot, '', null, null, failedToUpdateOldPrices);
                } else {
                    this.bot.messageAdmins(
                        `Failed to update old prices (probably because autoprice is set to true but item does not exist` +
                            ` on the pricer source):\n\n${failedToUpdateOldPrices.join(
                                '\n'
                            )}\n\nAll items above has been temporarily disabled.`,
                        []
                    );
                }
            }

            this.bot.pricelist.resetFailedUpdateOldPrices = 0;
        }

        // Send notification to admin/Discord Webhook if there's any partially priced item got reset on updateOldPrices
        const bulkUpdatedPartiallyPriced = this.bot.pricelist.partialPricedUpdateBulk;

        if (bulkUpdatedPartiallyPriced.length > 0) {
            const dw = this.opt.discordWebhook.sendAlert;
            const isDwEnabled = dw.enable && dw.url !== '';

            const msg = `All items below has been updated with partial price:\n\n• ${bulkUpdatedPartiallyPriced
                .map(sku => {
                    const name = this.bot.schema.getName(SKU.fromString(sku), this.opt.tradeSummary.showProperName);

                    return `${isDwEnabled ? `[${name}](https://www.prices.tf/items/${sku})` : name} (${sku})`;
                })
                .join('\n\n• ')}`;

            if (this.opt.sendAlert.enable && this.opt.sendAlert.partialPrice.onBulkUpdatePartialPriced) {
                if (isDwEnabled) {
                    sendAlert('onBulkUpdatePartialPriced', this.bot, msg);
                } else {
                    this.bot.messageAdmins(msg, []);
                }
            }
        }

        // Send notification to admin/Discord Webhook if there's any partially priced item got reset on updateOldPrices
        const bulkPartiallyPriced = this.bot.pricelist.autoResetPartialPriceBulk;

        if (bulkPartiallyPriced.length > 0) {
            const dw = this.opt.discordWebhook.sendAlert;
            const isDwEnabled = dw.enable && dw.url !== '';

            const msg =
                `All partially priced items below has been reset to use the current prices ` +
                `because no longer in stock or exceed the threshold:\n\n• ${bulkPartiallyPriced
                    .map(sku => {
                        const name = this.bot.schema.getName(SKU.fromString(sku), this.opt.tradeSummary.showProperName);

                        return `${isDwEnabled ? `[${name}](https://www.prices.tf/items/${sku})` : name} (${sku})`;
                    })
                    .join('\n• ')}`;

            if (this.opt.sendAlert.enable && this.opt.sendAlert.partialPrice.onResetAfterThreshold) {
                if (isDwEnabled) {
                    sendAlert('autoResetPartialPriceBulk', this.bot, msg);
                } else {
                    this.bot.messageAdmins(msg, []);
                }
            }
        }
    }

    onShutdown(): Promise<void> {
        if (this.poller) {
            clearInterval(this.poller);
        }

        if (this.refreshTimeout) {
            clearInterval(this.refreshTimeout);
        }

        if (this.sendStatsInterval) {
            clearInterval(this.sendStatsInterval);
        }

        if (this.autoRefreshListingsInterval) {
            clearInterval(this.autoRefreshListingsInterval);
        }

        if (this.classWeaponsTimeout) {
            clearTimeout(this.classWeaponsTimeout);
        }

        if (this.retryRequest) {
            clearTimeout(this.retryRequest);
        }

        this.bot.listings.disableAutorelistOption();

        return new Promise(resolve => {
            if (this.opt.autokeys.enable && this.autokeys.getActiveStatus) {
                log.debug('Disabling Autokeys and disabling key entry in the pricelist...');
                this.autokeys.disable(this.bot.pricelist.getKeyPrices);
            }

            if (this.bot.listingManager.ready !== true) {
                // We have not set up the listing manager, don't try and remove listings
                return resolve();
            }

            void this.bot.listings.removeAll().asCallback(err => {
                if (err) {
                    log.warn('Failed to remove all listings: ', err);
                }

                resolve();
            });
        });
    }

    onLoggedOn(): void {
        if (this.bot.isReady) {
            this.bot.client.setPersona(EPersonaState.Online);
            this.bot.client.gamesPlayed(this.opt.miscSettings.game.playOnlyTF2 ? 440 : [this.customGameName, 440]);
        }
    }

    onMessage(steamID: SteamID, message: string): void {
        if (!this.opt.commands.enable) {
            if (!this.bot.isAdmin(steamID)) {
                const custom = this.opt.commands.customDisableReply;
                return this.bot.sendMessage(steamID, custom ? custom : '❌ Command function is disabled by the owner.');
            }
        }

        if (this.isUpdating) {
            return this.bot.sendMessage(steamID, '⚠️ The bot is updating, please wait until I am back online.');
        }

        const steamID64 = steamID.toString();
        if (!this.bot.friends.isFriend(steamID64)) {
            return;
        }

        const friend = this.bot.friends.getFriend(steamID64);

        if (friend === null) {
            log.info(`Message from ${steamID64}: ${message}`);
        } else {
            log.info(`Message from ${friend.player_name} (${steamID64}): ${message}`);
        }

        if (this.recentlySentMessage[steamID64] !== undefined && this.recentlySentMessage[steamID64] >= 1) {
            return;
        }

        this.recentlySentMessage[steamID64] =
            (this.recentlySentMessage[steamID64] === undefined ? 0 : this.recentlySentMessage[steamID64]) + 1;

        this.commands.processMessage(steamID, message);
    }

    onLoginKey(loginKey: string): void {
        log.debug('New login key');

        files.writeFile(this.paths.files.loginKey, loginKey, false).catch(err => {
            log.warn('Failed to save login key: ', err);
        });
    }

    onLoginError(err: CustomError): void {
        if (err.eresult === EResult.InvalidPassword) {
            files.deleteFile(this.paths.files.loginKey).catch(err => {
                log.warn('Failed to delete login key: ', err);
            });
        }
    }

    onLoginAttempts(attempts: number[]): void {
        files.writeFile(this.paths.files.loginAttempts, attempts, true).catch(err => {
            log.warn('Failed to save login attempts: ', err);
        });
    }

    onFriendRelationship(steamID: SteamID, relationship: number): void {
        if (relationship === EFriendRelationship.Friend) {
            this.onNewFriend(steamID);
            this.checkFriendsCount(steamID);
        } else if (relationship === EFriendRelationship.RequestRecipient) {
            this.respondToFriendRequest(steamID);
        }
    }

    onGroupRelationship(groupID: SteamID, relationship: number): void {
        log.debug('Group relation changed', { steamID: groupID, relationship: relationship });
        if (relationship === EClanRelationship.Invited) {
            const join = this.groups.includes(groupID.getSteamID64());

            log.info(`Got invited to group ${groupID.getSteamID64()}, ${join ? 'accepting...' : 'declining...'}`);
            this.bot.client.respondToGroupInvite(groupID, join);
        } else if (relationship === EClanRelationship.Member) {
            log.info(`Joined group ${groupID.getSteamID64()}`);
        }
    }

    onBptfAuth(auth: { apiKey: string; accessToken: string }): void {
        const details = Object.assign({ private: true }, auth);
        log.warn('Please add your backpack.tf API key and access token to your environment variables!', details);
    }

    enableAutoRefreshListings(): void {
        // Automatically check for missing listings every 30 minutes
        if (this.isAutoRelistEnabled && this.isPremium === false) {
            return;
        }

        let pricelistLength = 0;

        this.autoRefreshListingsInterval = setInterval(
            () => {
                const opt = this.opt;
                const createListingsEnabled = opt.miscSettings.createListings.enable;

                if (this.alreadyExecutedRefreshlist || !createListingsEnabled) {
                    log.debug(
                        `❌ ${
                            this.alreadyExecutedRefreshlist
                                ? 'Just recently executed refreshlist command'
                                : 'miscSettings.createListings.enable is set to false'
                        }, will not run automatic check for missing listings.`
                    );

                    setTimeout(() => {
                        this.enableAutoRefreshListings();
                    }, this.executedDelayTime);

                    // reset to default
                    this.setRefreshlistExecutedDelay = 30 * 60 * 1000;
                    clearInterval(this.autoRefreshListingsInterval);
                    return;
                }

                pricelistLength = 0;
                log.debug('Running automatic check for missing listings...');

                const listingsSKUs: string[] = [];
                this.bot.listingManager.getListings(async err => {
                    if (err) {
                        setTimeout(() => {
                            this.enableAutoRefreshListings();
                        }, 30 * 60 * 1000);
                        clearInterval(this.autoRefreshListingsInterval);
                        return;
                    }

                    const inventory = this.bot.inventoryManager;
                    const isFilterCantAfford = opt.pricelist.filterCantAfford.enable;

                    this.bot.listingManager.listings.forEach(listing => {
                        let listingSKU = listing.getSKU();
                        if (listing.intent === 1) {
                            if (opt.normalize.painted.our && /;[p][0-9]+/.test(listingSKU)) {
                                listingSKU = listingSKU.replace(/;[p][0-9]+/, '');
                            }

                            if (opt.normalize.festivized.our && listingSKU.includes(';festive')) {
                                listingSKU = listingSKU.replace(';festive', '');
                            }

                            if (opt.normalize.strangeAsSecondQuality.our && listingSKU.includes(';strange')) {
                                listingSKU = listingSKU.replace(';strange', '');
                            }
                        } else {
                            if (/;[p][0-9]+/.test(listingSKU)) {
                                listingSKU = listingSKU.replace(/;[p][0-9]+/, '');
                            }
                        }

                        const match = this.bot.pricelist.getPrice(listingSKU);

                        if (isFilterCantAfford && listing.intent === 0 && match !== null) {
                            const canAffordToBuy = inventory.isCanAffordToBuy(match.buy, inventory.getInventory);
                            if (!canAffordToBuy) {
                                // Listing for buying exist but we can't afford to buy, remove.
                                log.debug(`Intent buy, removed because can't afford: ${match.sku}`);
                                listing.remove();
                            }
                        }

                        listingsSKUs.push(listingSKU);
                    });

                    // Remove duplicate elements
                    const newlistingsSKUs = new Set(listingsSKUs);
                    const uniqueSKUs = [...newlistingsSKUs];

                    const pricelist = this.bot.pricelist.getPrices.filter(entry => {
                        // First find out if lising for this item from bptf already exist.
                        const isExist = uniqueSKUs.find(sku => entry.sku === sku);

                        if (!isExist) {
                            // undefined - listing does not exist but item is in the pricelist

                            // Get amountCanBuy and amountCanSell (already cover intent and so on)
                            const amountCanBuy = inventory.amountCanTrade(entry.sku, true);
                            const amountCanSell = inventory.amountCanTrade(entry.sku, false);

                            if (
                                (amountCanBuy > 0 && inventory.isCanAffordToBuy(entry.buy, inventory.getInventory)) ||
                                amountCanSell > 0
                            ) {
                                // if can amountCanBuy is more than 0 and isCanAffordToBuy is true OR amountCanSell is more than 0
                                // return this entry
                                log.debug(
                                    `Missing${isFilterCantAfford ? '/Re-adding can afford' : ' listings'}: ${entry.sku}`
                                );
                                return true;
                            }

                            // Else ignore
                            return false;
                        }

                        // Else if listing already exist on backpack.tf, ignore
                        return false;
                    });

                    const pricelistCount = pricelist.length;

                    if (pricelistCount > 0) {
                        log.debug(
                            'Checking listings for ' +
                                pluralize('item', pricelistCount, true) +
                                ` [${pricelist.map(entry => entry.sku).join(', ')}]...`
                        );

                        await this.bot.listings.recursiveCheckPricelist(
                            pricelist,
                            true,
                            pricelistCount > 4000 ? 400 : 200,
                            true
                        );

                        log.debug('✅ Done checking ' + pluralize('item', pricelistCount, true));
                    } else {
                        log.debug('❌ Nothing to refresh.');
                    }

                    pricelistLength = pricelistCount;
                });
            },
            // set check every 60 minutes if pricelist to check was more than 4000 items
            (pricelistLength > 4000 ? 60 : 30) * 60 * 1000
        );
    }

    disableAutoRefreshListings(): void {
        if (this.isPremium) {
            return;
        }

        clearInterval(this.autoRefreshListingsInterval);
    }

    sendStats(): void {
        clearInterval(this.sendStatsInterval);

        if (this.sendStatsEnabled) {
            this.sendStatsInterval = setInterval(() => {
                const opt = this.bot.options;
                let times: string[];

                if (opt.statistics.sendStats.time.length === 0) {
                    times = ['T05:59', 'T11:59', 'T17:59', 'T23:59'];
                } else {
                    times = opt.statistics.sendStats.time;
                }

                const now = dayjs()
                    .tz(opt.timezone ? opt.timezone : 'UTC')
                    .format();

                if (times.some(time => now.includes(time))) {
                    if (opt.discordWebhook.sendStats.enable && opt.discordWebhook.sendStats.url !== '') {
                        void sendStats(this.bot);
                    } else {
                        this.bot.getAdmins.forEach(admin => {
                            this.commands.useStatsCommand(admin);
                        });
                    }
                }
            }, 1 * 60 * 1000);
        }
    }

    disableSendStats(): void {
        clearInterval(this.sendStatsInterval);
    }

    async onNewTradeOffer(offer: TradeOffer): Promise<null | OnNewTradeOffer> {
        offer.log('info', 'is being processed...');

        // Allow sending notifications
        offer.data('notify', true);

        // If crafting class weapons still waiting, cancel it.
        clearTimeout(this.classWeaponsTimeout);

        const opt = this.opt;

        const items = {
            our: Inventory.fromItems(
                this.bot.client.steamID === null ? this.botSteamID : this.bot.client.steamID,
                offer.itemsToGive,
                this.bot.manager,
                this.bot.schema,
                opt,
                this.bot.effects,
                this.bot.paints,
                this.bot.strangeParts,
                'our'
            ).getItems,
            their: Inventory.fromItems(
                offer.partner,
                offer.itemsToReceive,
                this.bot.manager,
                this.bot.schema,
                opt,
                this.bot.effects,
                this.bot.paints,
                this.bot.strangeParts,
                'their'
            ).getItems
        };

        const exchange = {
            contains: { items: false, metal: false, keys: false },
            our: { value: 0, keys: 0, scrap: 0, contains: { items: false, metal: false, keys: false } },
            their: { value: 0, keys: 0, scrap: 0, contains: { items: false, metal: false, keys: false } }
        };

        const itemsDict: ItemsDict = { our: {}, their: {} };
        const getHighValue: GetHighValue = {
            our: {
                items: {},
                isMention: false
            },
            their: {
                items: {},
                isMention: false
            }
        };

        let isDuelingNotFullUses = false;
        let isNoiseMakerNotFullUses = false;
        const noiseMakerNotFullSKUs: string[] = [];

        let hasNonTF2Items = false;

        const states = [false, true];
        for (let i = 0; i < states.length; i++) {
            const buying = states[i];
            const which = buying ? 'their' : 'our';

            for (const sku in items[which]) {
                if (!Object.prototype.hasOwnProperty.call(items[which], sku)) {
                    continue;
                }

                if (!testSKU(sku)) {
                    // Offer contains an item that is not from TF2
                    hasNonTF2Items = true;
                }

                if (sku === '5000;6') {
                    exchange.contains.metal = true;
                    exchange[which].contains.metal = true;
                } else if (sku === '5001;6') {
                    exchange.contains.metal = true;
                    exchange[which].contains.metal = true;
                } else if (sku === '5002;6') {
                    exchange.contains.metal = true;
                    exchange[which].contains.metal = true;
                } else if (sku === '5021;6') {
                    exchange.contains.keys = true;
                    exchange[which].contains.keys = true;
                } else {
                    exchange.contains.items = true;
                    exchange[which].contains.items = true;
                }

                // assign amount for sku
                itemsDict[which][sku] = items[which][sku].length;

                // Get High-value items
                items[which][sku].forEach(item => {
                    if (item.hv !== undefined) {
                        // If hv exist, get the high value and assign into items
                        getHighValue[which].items[sku] = item.hv;

                        Object.keys(item.hv).forEach(attachment => {
                            if (item.hv[attachment] !== undefined) {
                                for (const pSku in item.hv[attachment]) {
                                    if (!Object.prototype.hasOwnProperty.call(item.hv[attachment], pSku)) {
                                        continue;
                                    }

                                    if (item.hv[attachment as 's' | 'sp' | 'ks' | 'ke' | 'p'][pSku] === true) {
                                        getHighValue[which].isMention = true;
                                    }
                                }
                            }
                        });
                    } else if (item.isFullUses !== undefined) {
                        getHighValue[which].items[sku] = { isFull: item.isFullUses };

                        if (sku === '241;6' && item.isFullUses === false) {
                            isDuelingNotFullUses = true;
                        } else if (noiseMakers.has(sku) && item.isFullUses === false) {
                            isNoiseMakerNotFullUses = true;
                            noiseMakerNotFullSKUs.push(sku);
                        }
                    }
                });
            }
        }

        offer.data('dict', itemsDict);

        // Always check if trade partner is taking higher value items (such as spelled or strange parts) that are not in our pricelist

        const highValueMeta = {
            items: {
                our: getHighValue.our.items,
                their: getHighValue.their.items
            },
            isMention: {
                our: getHighValue.our.isMention,
                their: getHighValue.their.isMention
            }
        };

        const isContainsHighValue =
            Object.keys(getHighValue.our.items).length > 0 || Object.keys(getHighValue.their.items).length > 0;

        // Check if the offer is from an admin
        if (this.bot.isAdmin(offer.partner)) {
            offer.log(
                'trade',
                `is from an admin, accepting. Summary:\n${JSON.stringify(
                    summarize(offer, this.bot, 'summary-accepting', false),
                    null,
                    4
                )}`
            );

            return {
                action: 'accept',
                reason: 'ADMIN',
                meta: isContainsHighValue ? { highValue: highValueMeta } : undefined
            };
        }

        const itemsToGiveCount = offer.itemsToGive.length;
        const itemsToReceiveCount = offer.itemsToReceive.length;

        // check if the trade is valid
        const isCannotProceedProcessingOffer = itemsToGiveCount === 0 && itemsToReceiveCount === 0;

        if (isCannotProceedProcessingOffer) {
            log.warn('isCannotProceedProcessingOffer', {
                status: isCannotProceedProcessingOffer,
                offerData: offer
            });
            // Both itemsToGive and itemsToReceive are an empty array, abort.
            this.bot.sendMessage(
                offer.partner,
                `❌ Looks like there was some issue with Steam getting your offer data.` +
                    ` I will retry to get the offer data now.` +
                    ` My owner has been informed, and they might manually act on your offer later.`
            );

            const optDw = opt.discordWebhook;

            if (opt.sendAlert.unableToProcessOffer) {
                if (optDw.sendAlert.enable && optDw.sendAlert.url !== '') {
                    sendAlert('failed-processing-offer', this.bot, null, null, null, [
                        offer.partner.getSteamID64(),
                        offer.id
                    ]);
                } else {
                    this.bot.messageAdmins(
                        '',
                        `Unable to process offer #${offer.id} with ${offer.partner.getSteamID64()}.` +
                            ' The offer data received was broken because our side and their side are both empty.' +
                            `\nPlease manually check the offer (login as me): https://steamcommunity.com/tradeoffer/${offer.id}/` +
                            `\nSend "!faccept ${offer.id}" to force accept, or "!fdecline ${offer.id}" to decline.`,
                        []
                    );
                }
            }

            // Abort processing the offer.
            return;
        }

        if (hasNonTF2Items && opt.offerReceived.alwaysDeclineNonTF2Items) {
            // Using boolean because items dict always needs to be saved
            offer.log('info', 'contains items not from TF2, declining...');
            return { action: 'decline', reason: '🟨_CONTAINS_NON_TF2' };
        }

        const offerMessage = offer.message.toLowerCase();

        if (itemsToGiveCount === 0) {
            const isGift = [
                'gift',
                'donat', // So that 'donate' or 'donation' will also be accepted
                'tip', // All others are synonyms
                'tribute',
                'souvenir',
                'favor',
                'giveaway',
                'bonus',
                'grant',
                'bounty',
                'present',
                'contribution',
                'award',
                'nice', // Up until here actually
                'happy', // All below people might also use
                'thank',
                'goo', // For 'good', 'goodie' or anything else
                'awesome',
                'rep',
                'joy',
                'cute' // right?
            ].some(word => offerMessage.includes(word));

            if (isGift) {
                offer.log(
                    'trade',
                    `is a gift offer, accepting. Summary:\n${JSON.stringify(
                        summarize(offer, this.bot, 'summary-accepting', false),
                        null,
                        4
                    )}`
                );
                return {
                    action: 'accept',
                    reason: 'GIFT',
                    meta: isContainsHighValue ? { highValue: highValueMeta } : undefined
                };
            } else {
                if (opt.bypass.giftWithoutMessage.allow) {
                    offer.log(
                        'info',
                        'is a gift offer without any offer message, but allowed to be accepted, accepting...'
                    );

                    return {
                        action: 'accept',
                        reason: 'GIFT',
                        meta: isContainsHighValue ? { highValue: highValueMeta } : undefined
                    };
                } else {
                    offer.log('info', 'is a gift offer without any offer message, declining...');
                    return { action: 'decline', reason: 'GIFT_NO_NOTE' };
                }
            }
        } else if (itemsToGiveCount > 0 && itemsToReceiveCount === 0) {
            offer.log('info', 'is taking our items for free, declining...');
            return { action: 'decline', reason: 'CRIME_ATTEMPT' };
        }

        // Check for Dueling Mini-Game and/or Noise maker for 5x/25x Uses only when enabled
        // and decline if not 5x/25x and exist in pricelist

        const checkExist = this.bot.pricelist;

        if (opt.miscSettings.checkUses.duel && isDuelingNotFullUses) {
            if (checkExist.getPrice('241;6', true) !== null) {
                // Dueling Mini-Game: Only decline if exist in pricelist
                offer.log('info', 'contains Dueling Mini-Game that does not have 5 uses.');
                return { action: 'decline', reason: 'DUELING_NOT_5_USES' };
            }
        }

        if (opt.miscSettings.checkUses.noiseMaker && isNoiseMakerNotFullUses) {
            const isHasNoiseMaker = noiseMakerNotFullSKUs.some(sku => checkExist.getPrice(sku, true) !== null);
            if (isHasNoiseMaker) {
                // Noise Maker: Only decline if exist in pricelist
                offer.log('info', 'contains Noise Maker that does not have 25 uses.');
                return { action: 'decline', reason: 'NOISE_MAKER_NOT_25_USES' };
            }
        }

        const ourItemsHVCount = Object.keys(getHighValue.our.items).length;

        const isInPricelist =
            ourItemsHVCount > 0 // Only check if this not empty
                ? Object.keys(getHighValue.our.items).some(sku => {
                      return checkExist.getPrice(sku, false) !== null; // Return true if exist in pricelist, enabled or not.
                  })
                : null;

        if (ourItemsHVCount > 0 && isInPricelist === false) {
            // Decline trade that offer overpay on high valued (spelled) items that are not in our pricelist.
            offer.log('info', 'contains higher value item on our side that is not in our pricelist.');

            // Inform admin via Steam Chat or Discord Webhook Something Wrong Alert.
            const highValueOurNames: string[] = [];
            const itemsName = getHighValueItems(
                getHighValue.our.items,
                this.bot,
                this.bot.paints,
                this.bot.strangeParts
            );

            if (opt.sendAlert.enable && opt.sendAlert.highValue.tryingToTake) {
                if (opt.discordWebhook.sendAlert.enable && opt.discordWebhook.sendAlert.url !== '') {
                    for (const name in itemsName) {
                        if (!Object.prototype.hasOwnProperty.call(itemsName, name)) {
                            continue;
                        }

                        highValueOurNames.push(`_${name}_` + itemsName[name]);
                    }

                    sendAlert('tryingToTake', this.bot, null, null, null, highValueOurNames);
                } else {
                    for (const name in itemsName) {
                        if (!Object.prototype.hasOwnProperty.call(itemsName, name)) {
                            continue;
                        }

                        highValueOurNames.push(name + itemsName[name]);
                    }

                    this.bot.messageAdmins(
                        `Someone is attempting to purchase a high valued item that you own ` +
                            `but is not in your pricelist:\n- ${highValueOurNames.join('\n\n- ')}`,
                        []
                    );
                }
            }

            return {
                action: 'decline',
                reason: 'HIGH_VALUE_ITEMS_NOT_SELLING',
                meta: {
                    highValueName: highValueOurNames
                }
            };
        }

        const itemPrices: Prices = {};

        const keyPrice = this.bot.pricelist.getKeyPrice;
        let hasOverstock = false;
        let hasOverstockAndIsPartialPriced = false;
        let hasUnderstock = false;

        // A list of things that is wrong about the offer and other information
        const wrongAboutOffer: WrongAboutOffer[] = [];

        let assetidsToCheck: string[] = [];
        let skuToCheck: string[] = [];
        let hasNoPrice = false;
        let hasInvalidItemsOur = false;

        const craftAll = this.bot.craftWeapons;
        const uncraftAll = this.bot.uncraftWeapons;

        const itemsDiff = offer.getDiff();
        //?
        for (let i = 0; i < states.length; i++) {
            const buying = states[i];
            const which = buying ? 'their' : 'our';
            const intentString = buying ? 'buy' : 'sell';

            for (const sku in items[which]) {
                if (!Object.prototype.hasOwnProperty.call(items[which], sku)) {
                    continue;
                }

                const amount = items[which][sku].length;

                let isNonTF2Items = false;

                if (sku === '5000;6') {
                    exchange[which].value += amount;
                    exchange[which].scrap += amount;
                } else if (sku === '5001;6') {
                    const value = 3 * amount;
                    exchange[which].value += value;
                    exchange[which].scrap += value;
                } else if (sku === '5002;6') {
                    const value = 9 * amount;
                    exchange[which].value += value;
                    exchange[which].scrap += value;
                } else if (
                    this.isWeaponsAsCurrency.enable &&
                    (craftAll.includes(sku) || (this.isWeaponsAsCurrency.withUncraft && uncraftAll.includes(sku))) &&
                    this.bot.pricelist.getPrice(sku, true) === null
                ) {
                    const value = 0.5 * amount;
                    exchange[which].value += value;
                    exchange[which].scrap += value;
                } else {
                    let match: Entry | null = null;

                    if (hasNonTF2Items) {
                        if (testSKU(sku)) {
                            match =
                                which === 'our'
                                    ? this.bot.pricelist.getPrice(sku)
                                    : this.bot.pricelist.getPrice(sku, false, true);
                        } else {
                            isNonTF2Items = true;
                        }
                    } else {
                        match =
                            which === 'our'
                                ? this.bot.pricelist.getPrice(sku)
                                : this.bot.pricelist.getPrice(sku, false, true);
                    }

                    const notIncludeCraftweapons = this.isWeaponsAsCurrency.enable
                        ? !(
                              craftAll.includes(sku) ||
                              (this.isWeaponsAsCurrency.withUncraft && uncraftAll.includes(sku))
                          )
                        : true;

                    // TODO: Go through all assetids and check if the item is being sold for a specific price

                    if (match !== null && (sku !== '5021;6' || !exchange.contains.items)) {
                        // If we found a matching price and the item is not a key, or the we are not trading items
                        // (meaning that we are trading keys) then add the price of the item

                        // Add value of items
                        exchange[which].value += match[intentString].toValue(keyPrice.metal) * amount;
                        exchange[which].keys += match[intentString].keys * amount;
                        exchange[which].scrap += Currencies.toScrap(match[intentString].metal) * amount;

                        itemPrices[match.sku] = {
                            buy: match.buy,
                            sell: match.sell
                        };

                        // Check stock limits (not for keys)
                        const diff = itemsDiff[sku] as number | null;

                        const isBuying = diff > 0; // is buying if true.
                        const amountCanTrade = this.bot.inventoryManager.amountCanTrade(
                            sku,
                            isBuying,
                            which === 'their'
                        ); // return a number

                        if (diff !== 0 && sku !== '5021;6' && amountCanTrade < diff && notIncludeCraftweapons) {
                            if (match.enabled) {
                                // User is offering too many
                                hasOverstock = true;

                                if (match.isPartialPriced) {
                                    hasOverstockAndIsPartialPriced = true;
                                }

                                wrongAboutOffer.push({
                                    reason: '🟦_OVERSTOCKED',
                                    sku: sku,
                                    buying: isBuying,
                                    diff: diff,
                                    amountCanTrade: amountCanTrade,
                                    amountOffered: amount
                                });

                                this.bot.listings.checkBySKU(match.sku, null, which === 'their', true);
                            } else {
                                // Item was disabled
                                wrongAboutOffer.push({
                                    reason: '🟧_DISABLED_ITEMS',
                                    sku: sku
                                });
                            }
                        }

                        if (
                            diff !== 0 &&
                            !isBuying &&
                            sku !== '5021;6' &&
                            amountCanTrade < Math.abs(diff) &&
                            notIncludeCraftweapons
                        ) {
                            if (match.enabled) {
                                // User is taking too many
                                hasUnderstock = true;

                                wrongAboutOffer.push({
                                    reason: '🟩_UNDERSTOCKED',
                                    sku: sku,
                                    selling: !isBuying,
                                    diff: diff,
                                    amountCanTrade: amountCanTrade,
                                    amountTaking: amount
                                });

                                this.bot.listings.checkBySKU(match.sku, null, which === 'their', true);
                            } else {
                                // Item was disabled
                                wrongAboutOffer.push({
                                    reason: '🟧_DISABLED_ITEMS',
                                    sku: sku
                                });
                            }
                        }

                        const buyPrice = match.buy.toValue(keyPrice.metal);
                        const sellPrice = match.sell.toValue(keyPrice.metal);
                        const minimumKeysDupeCheck = this.minimumKeysDupeCheck * keyPrice.toValue();
                        if (
                            buying && // check only items on their side
                            (buyPrice > minimumKeysDupeCheck || sellPrice > minimumKeysDupeCheck)
                            // if their side contains invalid_items, will use our side value
                        ) {
                            skuToCheck = skuToCheck.concat(sku);
                            assetidsToCheck = assetidsToCheck.concat(items[which][sku].map(item => item.id));
                        }
                        //
                    } else if (sku === '5021;6' && exchange.contains.items) {
                        // Offer contains keys and we are not trading keys, add key value
                        exchange[which].value += keyPrice.toValue() * amount;
                        exchange[which].keys += amount;
                        //
                    } else if (
                        (match === null && notIncludeCraftweapons) ||
                        (match !== null && match.intent === (buying ? 1 : 0))
                    ) {
                        // Offer contains an item that we are not trading
                        // hasInvalidItems = true;

                        // If that particular item is on our side, then put to review
                        if (which === 'our') {
                            hasInvalidItemsOur = true;
                        }

                        let itemSuggestedValue = 'No price';

                        if (!isNonTF2Items) {
                            // await sleepasync().Promise.sleep(1 * 1000);
                            const price = await this.bot.pricelist.getItemPrices(sku);
                            const item = SKU.fromString(sku);

                            const isCrateOrCases = item.crateseries !== null || ['5737;6', '5738;6'].includes(sku);
                            // 5737;6 and 5738;6 - Mann Co. Stockpile Crate

                            const isWinterNoiseMaker = ['673;6'].includes(sku);

                            const isSkinsOrWarPaints = item.wear !== null;

                            if (price === null) {
                                hasNoPrice = true;
                            } else {
                                price.buy = new Currencies(price.buy);
                                price.sell = new Currencies(price.sell);

                                itemPrices[sku] = {
                                    buy: price.buy,
                                    sell: price.sell
                                };

                                if (
                                    opt.offerReceived.invalidItems.givePrice &&
                                    !isSkinsOrWarPaints &&
                                    !isCrateOrCases &&
                                    !isWinterNoiseMaker // all of these (with !) should be false in order to be true
                                ) {
                                    // if offerReceived.invalidItems.givePrice is set to true (enable) and items is not skins/war paint/crate/cases,
                                    // then give that item price and include in exchange
                                    exchange[which].value += price[intentString].toValue(keyPrice.metal) * amount;
                                    exchange[which].keys += price[intentString].keys * amount;
                                    exchange[which].scrap += Currencies.toScrap(price[intentString].metal) * amount;
                                }
                                const valueInRef = {
                                    buy: Currencies.toRefined(price.buy.toValue(keyPrice.metal)),
                                    sell: Currencies.toRefined(price.sell.toValue(keyPrice.metal))
                                };

                                itemSuggestedValue =
                                    (intentString === 'buy' ? valueInRef.buy : valueInRef.sell) >= keyPrice.metal
                                        ? `${valueInRef.buy.toString()} ref (${price.buy.toString()})` +
                                          ` / ${valueInRef.sell.toString()} ref (${price.sell.toString()})`
                                        : `${price.buy.toString()} / ${price.sell.toString()}`;
                            }
                        }

                        wrongAboutOffer.push({
                            reason: '🟨_INVALID_ITEMS',
                            sku: sku,
                            buying: buying,
                            amount: amount,
                            price: itemSuggestedValue
                        });
                    }
                }
            }
        }

        // Doing this so that the prices will always be displayed as only metal
        if (opt.miscSettings.showOnlyMetal.enable) {
            exchange.our.scrap += exchange.our.keys * keyPrice.toValue();
            exchange.our.keys = 0;
            exchange.their.scrap += exchange.their.keys * keyPrice.toValue();
            exchange.their.keys = 0;
        }

        offer.data('value', {
            our: {
                total: exchange.our.value,
                keys: exchange.our.keys,
                metal: Currencies.toRefined(exchange.our.scrap)
            },
            their: {
                total: exchange.their.value,
                keys: exchange.their.keys,
                metal: Currencies.toRefined(exchange.their.scrap)
            },
            rate: keyPrice.metal
        });

        offer.data('prices', itemPrices);

        if (exchange.contains.metal && !exchange.contains.keys && !exchange.contains.items) {
            // Offer only contains metal
            offer.log('info', 'only contains metal, declining...');
            return { action: 'decline', reason: 'ONLY_METAL' };
        } else if (exchange.contains.keys && !exchange.contains.items) {
            // Offer is for trading keys, check if we are trading them
            const priceEntry = this.bot.pricelist.getPrice('5021;6', true);
            if (priceEntry === null) {
                // We are not trading keys
                offer.log('info', 'we are not trading keys, declining...');
                this.bot.listings.checkBySKU('5021;6', null, false, true);
                return { action: 'decline', reason: 'NOT_TRADING_KEYS' };
            } else if (exchange.our.contains.keys && priceEntry.intent !== 1 && priceEntry.intent !== 2) {
                // We are not selling keys
                offer.log('info', 'we are not selling keys, declining...');
                this.bot.listings.checkBySKU('5021;6', null, false, true);
                return { action: 'decline', reason: 'NOT_SELLING_KEYS' };
            } else if (exchange.their.contains.keys && priceEntry.intent !== 0 && priceEntry.intent !== 2) {
                // We are not buying keys
                offer.log('info', 'we are not buying keys, declining...');
                this.bot.listings.checkBySKU('5021;6', null, false, true);
                return { action: 'decline', reason: 'NOT_BUYING_KEYS' };
            } else {
                // Check overstock / understock on keys
                const diff = itemsDiff['5021;6'] as number | null;
                // If the diff is greater than 0 then we are buying, less than is selling
                this.isTradingKeys = true;
                const isBuying = diff > 0;
                const amountCanTrade = this.bot.inventoryManager.amountCanTrade('5021;6', isBuying);

                if (diff !== 0 && amountCanTrade < diff) {
                    // User is offering too many
                    hasOverstock = true;
                    wrongAboutOffer.push({
                        reason: '🟦_OVERSTOCKED',
                        sku: '5021;6',
                        buying: isBuying,
                        diff: diff,
                        amountCanTrade: amountCanTrade,
                        amountOffered: itemsDict['their']['5021;6']
                    });

                    this.bot.listings.checkBySKU('5021;6', null, false, true);
                }

                const acceptUnderstock = opt.autokeys.accept.understock;
                if (diff !== 0 && !isBuying && amountCanTrade < Math.abs(diff) && !acceptUnderstock) {
                    // User is taking too many
                    hasUnderstock = true;

                    wrongAboutOffer.push({
                        reason: '🟩_UNDERSTOCKED',
                        sku: '5021;6',
                        selling: !isBuying,
                        diff: diff,
                        amountCanTrade: amountCanTrade,
                        amountTaking: itemsDict['our']['5021;6']
                    });

                    this.bot.listings.checkBySKU('5021;6', null, false, true);
                }
            }
        }

        let isOurItems = false;
        let isTheirItems = false;
        const exceptionSKU = opt.offerReceived.invalidValue.exceptionValue.skus;
        const exceptionValue = this.invalidValueException;

        if (exceptionSKU.length > 0 && exceptionValue > 0) {
            const ourItems = Object.keys(itemsDict.our);
            isOurItems = exceptionSKU.some(sku => {
                return ourItems.some(ourItemSKU => {
                    return ourItemSKU.includes(sku);
                });
            });

            const theirItems = Object.keys(itemsDict.their);
            isTheirItems = exceptionSKU.some(sku => {
                return theirItems.some(theirItemSKU => {
                    return theirItemSKU.includes(sku);
                });
            });
        }

        const isExcept = isOurItems || isTheirItems;

        let hasInvalidValue = false;
        if (exchange.our.value > exchange.their.value) {
            if (!isExcept || (isExcept && exchange.our.value - exchange.their.value >= exceptionValue)) {
                // Check if the values are correct and is not include the exception sku
                // OR include the exception sku but the invalid value is more than or equal to exception value
                hasInvalidValue = true;
                this.hasInvalidValueException = false;
                wrongAboutOffer.push({
                    reason: '🟥_INVALID_VALUE',
                    our: exchange.our.value,
                    their: exchange.their.value
                });
            } else if (isExcept && exchange.our.value - exchange.their.value < exceptionValue) {
                log.info(
                    `Contains ${exceptionSKU.join(' or ')} and difference is ${Currencies.toRefined(
                        exchange.our.value - exchange.their.value
                    )} ref which is less than your exception value of ${Currencies.toRefined(
                        exceptionValue
                    )} ref. Accepting/checking for other reasons...`
                );
                this.hasInvalidValueException = true;
            }
        }

        const manualReviewEnabled = opt.manualReview.enable;
        if (!manualReviewEnabled) {
            if (hasOverstock) {
                offer.log('info', 'is offering too many, declining...');
                const reasons = wrongAboutOffer.map(wrong => wrong.reason);
                const uniqueReasons = reasons.filter(reason => reasons.includes(reason));

                return {
                    action: 'decline',
                    reason: '🟦_OVERSTOCKED',
                    meta: {
                        uniqueReasons: filterReasons(uniqueReasons),
                        reasons: wrongAboutOffer
                    }
                };
            }

            if (hasUnderstock) {
                offer.log('info', 'is taking too many, declining...');
                const reasons = wrongAboutOffer.map(wrong => wrong.reason);
                const uniqueReasons = reasons.filter(reason => reasons.includes(reason));

                return {
                    action: 'decline',
                    reason: '🟩_UNDERSTOCKED',
                    meta: {
                        uniqueReasons: filterReasons(uniqueReasons),
                        reasons: wrongAboutOffer
                    }
                };
            }

            if (hasInvalidValue) {
                // We are offering more than them, decline the offer
                offer.log('info', 'is not offering enough, declining...');
                const reasons = wrongAboutOffer.map(wrong => wrong.reason);
                const uniqueReasons = reasons.filter(reason => reasons.includes(reason));

                return {
                    action: 'decline',
                    reason: '🟥_INVALID_VALUE',
                    meta: {
                        uniqueReasons: filterReasons(uniqueReasons),
                        reasons: wrongAboutOffer
                    }
                };
            }
        }

        if (exchange.our.value < exchange.their.value && !opt.bypass.overpay.allow) {
            offer.log('info', 'is offering more than needed, declining...');
            return { action: 'decline', reason: 'OVERPAY' };
        }

        const assetidsToCheckCount = assetidsToCheck.length;

        if (this.dupeCheckEnabled && assetidsToCheckCount > 0) {
            offer.log('info', 'checking ' + pluralize('item', assetidsToCheckCount, true) + ' for dupes...');
            const inventory = new TF2Inventory(offer.partner, this.bot.manager);

            const requests = assetidsToCheck.map(assetid => {
                return (callback: (err: Error | null, result: boolean | null) => void): void => {
                    log.debug('Dupe checking ' + assetid + '...');
                    void Promise.resolve(inventory.isDuped(assetid)).asCallback((err, result) => {
                        log.debug('Dupe check for ' + assetid + ' done');
                        callback(err, result);
                    });
                };
            });

            try {
                const result: (boolean | null)[] = await Promise.fromCallback(callback => {
                    async.series(requests, callback);
                });
                log.debug('Got result from dupe checks on ' + assetidsToCheck.join(', '), { result: result });

                const declineDupes = opt.offerReceived.duped.autoDecline.enable;
                const resultCount = result.length;

                for (let i = 0; i < resultCount; i++) {
                    if (result[i] === true) {
                        // Found duped item
                        if (declineDupes) {
                            // Offer contains duped items, decline it
                            return {
                                action: 'decline',
                                reason: '🟫_DUPED_ITEMS',
                                meta: { assetids: assetidsToCheck, sku: skuToCheck, result: result }
                            };
                        } else {
                            // Offer contains duped items but we don't decline duped items, instead add it to the wrong about offer list and continue
                            wrongAboutOffer.push({
                                reason: '🟫_DUPED_ITEMS',
                                assetid: assetidsToCheck[i],
                                sku: skuToCheck[i]
                            });
                        }
                    } else if (result[i] === null) {
                        // Could not determine if the item was duped, make the offer be pending for review
                        wrongAboutOffer.push({
                            reason: '🟪_DUPE_CHECK_FAILED',
                            withError: false,
                            assetid: assetidsToCheck[i],
                            sku: skuToCheck[i]
                        });
                    }
                }
            } catch (err) {
                log.warn('Failed dupe check on ' + assetidsToCheck.join(', ') + ': ' + (err as Error).message);
                wrongAboutOffer.push({
                    reason: '🟪_DUPE_CHECK_FAILED',
                    withError: true,
                    assetid: assetidsToCheck,
                    sku: skuToCheck,
                    error: (err as Error).message
                });
            }
        }

        offer.log('info', 'checking escrow...');

        try {
            const hasEscrow = await this.bot.checkEscrow(offer);

            if (hasEscrow) {
                offer.log('info', 'would be held if accepted, declining...');
                return { action: 'decline', reason: 'ESCROW' };
            }
        } catch (err) {
            log.warn('Failed to check escrow: ', err);

            wrongAboutOffer.push({
                reason: '⬜_ESCROW_CHECK_FAILED'
            });

            const reasons = wrongAboutOffer.map(wrong => wrong.reason);
            const uniqueReasons = reasons.filter(reason => reasons.includes(reason));

            if (!opt.offerReceived.escrowCheckFailed.ignoreFailed) {
                return {
                    action: 'skip',
                    reason: '⬜_ESCROW_CHECK_FAILED',
                    meta: {
                        uniqueReasons: filterReasons(uniqueReasons),
                        reasons: wrongAboutOffer,
                        highValue: isContainsHighValue ? highValueMeta : undefined
                    }
                };
            } else {
                // Do nothing. bad.
                return;
            }
        }

        offer.log('info', 'checking bans...');

        try {
            const isBanned = await this.bot.checkBanned(offer.partner.getSteamID64());

            if (isBanned) {
                offer.log('info', 'partner is banned in one or more communities, declining...');
                this.bot.client.blockUser(offer.partner, err => {
                    if (err) {
                        log.warn(`❌ Failed to block user ${offer.partner.getSteamID64()}: `, err);
                    }
                    log.debug(`✅ Successfully blocked user ${offer.partner.getSteamID64()}`);
                });

                return { action: 'decline', reason: 'BANNED' };
            }
        } catch (err) {
            log.warn('Failed to check banned: ', err);

            wrongAboutOffer.push({
                reason: '⬜_BANNED_CHECK_FAILED'
            });

            const reasons = wrongAboutOffer.map(wrong => wrong.reason);
            const uniqueReasons = reasons.filter(reason => reasons.includes(reason));

            if (!opt.offerReceived.bannedCheckFailed.ignoreFailed) {
                return {
                    action: 'skip',
                    reason: '⬜_BANNED_CHECK_FAILED',
                    meta: {
                        uniqueReasons: filterReasons(uniqueReasons),
                        reasons: wrongAboutOffer,
                        highValue: isContainsHighValue ? highValueMeta : undefined
                    }
                };
            } else {
                // Do nothing. bad.
                return;
            }
        }

        // TO DO: Counter offer?

        if (wrongAboutOffer.length !== 0) {
            const reasons = wrongAboutOffer.map(wrong => wrong.reason);
            const uniqueReasons = filterReasons(reasons.filter(reason => reasons.includes(reason)));

            const isInvalidValue = uniqueReasons.includes('🟥_INVALID_VALUE');
            const isInvalidItem = uniqueReasons.includes('🟨_INVALID_ITEMS');
            const isDisabledItem = uniqueReasons.includes('🟧_DISABLED_ITEMS');
            const isOverstocked = uniqueReasons.includes('🟦_OVERSTOCKED');
            const isUnderstocked = uniqueReasons.includes('🟩_UNDERSTOCKED');
            const isDupedItem = uniqueReasons.includes('🟫_DUPED_ITEMS');
            const isDupedCheckFailed = uniqueReasons.includes('🟪_DUPE_CHECK_FAILED');

            const canAcceptInvalidItemsOverpay = opt.offerReceived.invalidItems.autoAcceptOverpay;
            const canAcceptDisabledItemsOverpay = opt.offerReceived.disabledItems.autoAcceptOverpay;
            const canAcceptOverstockedOverpay = opt.offerReceived.overstocked.autoAcceptOverpay;
            const canAcceptUnderstockedOverpay = opt.offerReceived.understocked.autoAcceptOverpay;

            // accepting 🟨_INVALID_ITEMS overpay
            const isAcceptInvalidItems =
                isInvalidItem &&
                canAcceptInvalidItemsOverpay &&
                !hasInvalidItemsOur &&
                (exchange.our.value < exchange.their.value ||
                    (exchange.our.value === exchange.their.value && hasNoPrice)) &&
                (isOverstocked ? canAcceptOverstockedOverpay : true) &&
                (isUnderstocked ? canAcceptUnderstockedOverpay : true) &&
                (isDisabledItem ? canAcceptDisabledItemsOverpay : true);

            // accepting 🟧_DISABLED_ITEMS overpay
            const isAcceptDisabledItems =
                isDisabledItem &&
                canAcceptDisabledItemsOverpay &&
                exchange.our.value < exchange.their.value &&
                (isInvalidItem ? canAcceptInvalidItemsOverpay : true) &&
                (isOverstocked ? canAcceptOverstockedOverpay : true) &&
                (isUnderstocked ? canAcceptUnderstockedOverpay : true);

            // accepting 🟦_OVERSTOCKED overpay
            const isAcceptOverstocked =
                isOverstocked &&
                canAcceptOverstockedOverpay &&
                !hasOverstockAndIsPartialPriced && // because partial priced will use old buying prices
                exchange.our.value < exchange.their.value &&
                (isInvalidItem ? canAcceptInvalidItemsOverpay : true) &&
                (isUnderstocked ? canAcceptUnderstockedOverpay : true) &&
                (isDisabledItem ? canAcceptDisabledItemsOverpay : true);

            // accepting 🟩_UNDERSTOCKED overpay
            const isAcceptUnderstocked =
                isUnderstocked &&
                canAcceptUnderstockedOverpay &&
                exchange.our.value < exchange.their.value &&
                (isInvalidItem ? canAcceptInvalidItemsOverpay : true) &&
                (isOverstocked ? canAcceptOverstockedOverpay : true) &&
                (isDisabledItem ? canAcceptDisabledItemsOverpay : true);

            if (
                (isAcceptInvalidItems || isAcceptOverstocked || isAcceptUnderstocked || isAcceptDisabledItems) &&
                exchange.our.value !== 0 &&
                !(isInvalidValue || isDupedItem || isDupedCheckFailed)
            ) {
                // if the offer is Invalid_items/disabled_items/over/understocked and accepting overpay enabled, but the offer is not
                // includes Invalid_value, duped or duped check failed, true for acceptTradeCondition and our side not empty,
                // accept the trade.
                offer.log(
                    'trade',
                    `contains ${
                        (isAcceptInvalidItems ? 'INVALID_ITEMS' : '') +
                        (isAcceptOverstocked ? `${isAcceptInvalidItems ? '/' : ''}OVERSTOCKED` : '') +
                        (isAcceptUnderstocked
                            ? `${isAcceptInvalidItems || isAcceptOverstocked ? '/' : ''}UNDERSTOCKED`
                            : '') +
                        (isAcceptDisabledItems
                            ? `${
                                  isAcceptInvalidItems || isAcceptOverstocked || isAcceptUnderstocked ? '/' : ''
                              }DISABLED_ITEMS`
                            : '')
                    }, but offer value is greater or equal, accepting. Summary:\n${JSON.stringify(
                        summarize(offer, this.bot, 'summary-accepting', false),
                        null,
                        4
                    )}`
                );

                if (opt.offerReceived.sendPreAcceptMessage.enable) {
                    const preAcceptMessage = opt.customMessage.accepted.automatic;

                    if (itemsToGiveCount + itemsToReceiveCount > 50) {
                        this.bot.sendMessage(
                            offer.partner,
                            preAcceptMessage.largeOffer
                                ? preAcceptMessage.largeOffer
                                : 'I have accepted your offer. The trade may take a while to finalize due to it being a large offer.' +
                                      ' If the trade does not finalize after 5-10 minutes has passed, please send your offer again, ' +
                                      'or add me and use the !sell/!sellcart or !buy/!buycart command.'
                        );
                    } else {
                        this.bot.sendMessage(
                            offer.partner,
                            preAcceptMessage.smallOffer
                                ? preAcceptMessage.smallOffer
                                : 'I have accepted your offer. The trade should be finalized shortly.' +
                                      ' If the trade does not finalize after 1-2 minutes has passed, please send your offer again, ' +
                                      'or add me and use the !sell/!sellcart or !buy/!buycart command.'
                        );
                    }
                }

                return {
                    action: 'accept',
                    reason: 'VALID_WITH_OVERPAY',
                    meta: {
                        uniqueReasons: uniqueReasons,
                        reasons: wrongAboutOffer,
                        highValue: isContainsHighValue ? highValueMeta : undefined
                    }
                };
            } else if (
                opt.offerReceived.invalidValue.autoDecline.enable &&
                isInvalidValue &&
                !(
                    isUnderstocked ||
                    isInvalidItem ||
                    isDisabledItem ||
                    isOverstocked ||
                    isDupedItem ||
                    isDupedCheckFailed
                ) &&
                this.hasInvalidValueException === false
            ) {
                // If only INVALID_VALUE and did not matched exception value, will just decline the trade.
                return { action: 'decline', reason: 'ONLY_INVALID_VALUE' };
            } else if (
                opt.offerReceived.invalidItems.autoDecline.enable &&
                isInvalidItem &&
                !(
                    isDisabledItem ||
                    isUnderstocked ||
                    isInvalidValue ||
                    isOverstocked ||
                    isDupedItem ||
                    isDupedCheckFailed
                )
            ) {
                // If only INVALID_ITEMS and Auto-decline INVALID_ITEMS enabled, will just decline the trade.
                return { action: 'decline', reason: 'ONLY_INVALID_ITEMS' };
            } else if (
                opt.offerReceived.disabledItems.autoDecline.enable &&
                isDisabledItem &&
                !(
                    isInvalidItem ||
                    isUnderstocked ||
                    isInvalidValue ||
                    isOverstocked ||
                    isDupedItem ||
                    isDupedCheckFailed
                )
            ) {
                // If only DISABLED_ITEMS and Auto-decline DISABLED_ITEMS enabled, will just decline the trade.
                return { action: 'decline', reason: 'ONLY_DISABLED_ITEMS' };
            } else if (
                opt.offerReceived.overstocked.autoDecline.enable &&
                isOverstocked &&
                !(isInvalidItem || isDisabledItem || isDupedItem || isDupedCheckFailed)
            ) {
                // If only OVERSTOCKED and Auto-decline OVERSTOCKED enabled, will just decline the trade.
                return { action: 'decline', reason: 'ONLY_OVERSTOCKED' };
            } else if (
                opt.offerReceived.understocked.autoDecline.enable &&
                isUnderstocked &&
                !(isInvalidItem || isDisabledItem || isDupedItem || isDupedCheckFailed)
            ) {
                // If only UNDERSTOCKED and Auto-decline UNDERSTOCKED enabled, will just decline the trade.
                return { action: 'decline', reason: 'ONLY_UNDERSTOCKED' };
            } else {
                offer.log('info', `offer needs review (${uniqueReasons.join(', ')}), skipping...`);

                return {
                    action: 'skip',
                    reason: 'REVIEW',
                    meta: {
                        uniqueReasons: uniqueReasons,
                        reasons: wrongAboutOffer,
                        highValue: isContainsHighValue ? highValueMeta : undefined
                    }
                };
            }
        }

        offer.log(
            'trade',
            `accepting. Summary:\n${JSON.stringify(summarize(offer, this.bot, 'summary-accepting', false), null, 4)}`
        );

        if (opt.offerReceived.sendPreAcceptMessage.enable) {
            const preAcceptMessage = opt.customMessage.accepted.automatic;

            if (itemsToGiveCount + itemsToReceiveCount > 50) {
                this.bot.sendMessage(
                    offer.partner,
                    preAcceptMessage.largeOffer
                        ? preAcceptMessage.largeOffer
                        : 'I have accepted your offer. The trade may take a while to finalize due to it being a large offer.' +
                              ' If the trade does not finalize after 5-10 minutes has passed, please send your offer again, ' +
                              'or add me and use the !sell/!sellcart or !buy/!buycart command.'
                );
            } else {
                this.bot.sendMessage(
                    offer.partner,
                    preAcceptMessage.smallOffer
                        ? preAcceptMessage.smallOffer
                        : 'I have accepted your offer. The trade will be finalized shortly.' +
                              ' If the trade does not finalize after 1-2 minutes has passed, please send your offer again, ' +
                              'or add me and use the !sell/!sellcart or !buy/!buycart command.'
                );
            }
        }

        return {
            action: 'accept',
            reason: 'VALID',
            meta: isContainsHighValue ? { highValue: highValueMeta } : undefined
        };
    }

    onTradeOfferChanged(offer: TradeOffer, oldState: number, timeTakenToComplete?: number): void {
        // Not sure if it can go from other states to active
        if (oldState === TradeOfferManager.ETradeOfferState['Accepted']) {
            offer.data('switchedState', oldState);
        }

        const highValue: {
            isDisableSKU: string[];
            theirItems: string[];
            items: Items;
        } = {
            isDisableSKU: [],
            theirItems: [],
            items: {}
        };

        if (offer.data('handledByUs') === true) {
            if (offer.data('notify') === true && offer.data('switchedState') !== offer.state) {
                if (offer.state === TradeOfferManager.ETradeOfferState['Accepted']) {
                    accepted(offer, this.bot);

                    if (offer.data('donation')) {
                        this.bot.messageAdmins('✅ Success! Your donation has been sent and received!', []);
                    } else if (offer.data('buyBptfPremium')) {
                        this.bot.messageAdmins('✅ Success! Your premium purchase has been sent and received!', []);
                    }
                } else if (offer.state === TradeOfferManager.ETradeOfferState['InEscrow']) {
                    acceptEscrow(offer, this.bot);
                } else if (offer.state === TradeOfferManager.ETradeOfferState['Declined']) {
                    declined(offer, this.bot, this.isTradingKeys);
                    this.isTradingKeys = false; // reset
                    this.removePolldataKeys(offer);
                } else if (offer.state === TradeOfferManager.ETradeOfferState['Canceled']) {
                    cancelled(offer, oldState, this.bot);
                    this.removePolldataKeys(offer);
                } else if (offer.state === TradeOfferManager.ETradeOfferState['InvalidItems']) {
                    invalid(offer, this.bot);
                    this.removePolldataKeys(offer);
                }
            }

            if (offer.state === TradeOfferManager.ETradeOfferState['Accepted'] && !this.sentSummary[offer.id]) {
                // Only run this if the bot handled the offer and do not send again if already sent once

                clearTimeout(this.resetSentSummaryTimeout);
                this.sentSummary[offer.id] = true;

                offer.data('isAccepted', true);
                offer.log('trade', 'has been accepted.');

                // Auto sell and buy keys if ref < minimum

                this.autokeys.check();

                const result = processAccepted(offer, this.bot, this.isTradingKeys, timeTakenToComplete);
                this.isTradingKeys = false; // reset

                highValue.isDisableSKU = result.isDisableSKU;
                highValue.theirItems = result.theirHighValuedItems;
                highValue.items = result.items;
            }
        }

        if (offer.state === TradeOfferManager.ETradeOfferState['Accepted']) {
            // Offer is accepted

            // Smelt / combine metal
            keepMetalSupply(this.bot, this.minimumScrap, this.minimumReclaimed, this.combineThreshold);

            // Craft duplicated weapons
            void craftDuplicateWeapons(this.bot);

            this.classWeaponsTimeout = setTimeout(() => {
                // called after 5 second to craft metals and duplicated weapons first.
                void craftClassWeapons(this.bot);
            }, 5 * 1000);

            // Sort inventory
            this.sortInventory();

            // Tell bot uptime
            log.debug(uptime());

            // Update listings
            updateListings(offer, this.bot, highValue);

            // Invite to group
            this.inviteToGroups(offer.partner);

            // delete notify and meta keys from polldata after each successful trades
            this.removePolldataKeys(offer);

            this.resetSentSummaryTimeout = setTimeout(() => {
                this.sentSummary = {};
            }, 2 * 60 * 1000);
        }
    }

    private removePolldataKeys(offer: TradeOffer): void {
        offer.data('notify', undefined);
        offer.data('meta', undefined);
    }

    onOfferAction(offer: TradeOffer, action: 'accept' | 'decline' | 'skip', reason: string, meta: Meta): void {
        if (offer.data('notify') !== true) {
            return;
        }

        if (action === 'skip') {
            return sendReview(offer, this.bot, meta, this.isTradingKeys);
        }
    }

    private sortInventory(): void {
        if (this.opt.miscSettings.sortInventory.enable) {
            const type = this.opt.miscSettings.sortInventory.type;
            this.bot.tf2gc.sortInventory(type);
        }
    }

    private inviteToGroups(steamID: SteamID | string): void {
        if (!this.opt.miscSettings.sendGroupInvite.enable) {
            return;
        }

        this.bot.groups.inviteToGroups(steamID, this.groups);
    }

    private checkFriendRequests(): void {
        if (!this.bot.client.myFriends) {
            return;
        }

        this.checkFriendsCount();
        for (const steamID64 in this.bot.client.myFriends) {
            if (!Object.prototype.hasOwnProperty.call(this.bot.client.myFriends, steamID64)) {
                continue;
            }

            if ((this.bot.client.myFriends[steamID64] as number) === EFriendRelationship.RequestRecipient) {
                // relation
                this.respondToFriendRequest(steamID64);
            }
        }

        this.bot.getAdmins.forEach(steamID => {
            if (!this.bot.friends.isFriend(steamID)) {
                log.info(`Not friends with admin ${steamID.toString()}, sending friend request...`);
                this.bot.client.addFriend(steamID, err => {
                    if (err) {
                        log.warn('Failed to send friend request: ', err);
                    }
                });
            }
        });
    }

    private respondToFriendRequest(steamID: SteamID | string): void {
        if (!this.opt.miscSettings.addFriends.enable) {
            if (!this.bot.isAdmin(steamID)) {
                return this.bot.client.removeFriend(steamID);
            }
        }

        const steamID64 = typeof steamID === 'string' ? steamID : steamID.getSteamID64();
        log.debug(`Sending friend request to ${steamID64}...`);
        this.bot.client.addFriend(steamID, err => {
            if (err) {
                log.warn(`Failed to a send friend request to ${steamID64}: `, err);
                return;
            }
            log.debug('Friend request has been sent / accepted');
        });
    }

    private onNewFriend(steamID: SteamID, tries = 0): void {
        if (tries === 0) {
            log.debug(`Now friends with ${steamID.getSteamID64()}`);
        }

        const isAdmin = this.bot.isAdmin(steamID);
        setImmediate(() => {
            if (!this.bot.friends.isFriend(steamID)) {
                return;
            }

            const friend = this.bot.friends.getFriend(steamID);
            if (friend === null || friend.player_name === undefined) {
                tries++;

                if (tries >= 5) {
                    log.info(`I am now friends with ${steamID.getSteamID64()}`);

                    return this.bot.sendMessage(
                        steamID,
                        this.opt.customMessage.welcome
                            ? this.opt.customMessage.welcome
                                  .replace(/%name%/g, '')
                                  .replace(/%admin%/g, isAdmin ? '!help' : '!how2trade') +
                                  ` - TF2Autobot v${process.env.BOT_VERSION}`
                            : `Hi! If you don't know how things work, please type "!` +
                                  (isAdmin ? 'help' : 'how2trade') +
                                  `" - TF2Autobot v${process.env.BOT_VERSION}`
                    );
                }

                log.debug('Waiting for name');
                // Wait for friend info to be available
                setTimeout(() => {
                    this.onNewFriend(steamID, tries);
                }, exponentialBackoff(tries - 1, 200));
                return;
            }

            log.info(`I am now friends with ${friend.player_name} (${steamID.getSteamID64()})`);

            this.bot.sendMessage(
                steamID,
                this.opt.customMessage.welcome
                    ? this.opt.customMessage.welcome
                          .replace(/%name%/g, friend.player_name)
                          .replace(/%admin%/g, isAdmin ? '!help' : '!how2trade') +
                          ` - TF2Autobot v${process.env.BOT_VERSION}`
                    : `Hi ${friend.player_name}! If you don't know how things work, please type "!` +
                          (isAdmin ? 'help' : 'how2trade') +
                          `" - TF2Autobot v${process.env.BOT_VERSION}`
            );
        });
    }

    private checkFriendsCount(steamIDToIgnore?: SteamID | string): void {
        log.debug('Checking friends count');
        const friends = this.bot.friends.getFriends;
        const friendslistBuffer = 20;
        const friendsToRemoveCount = friends.length + friendslistBuffer - this.bot.friends.maxFriends;

        log.debug(`Friends to remove: ${friendsToRemoveCount}`);
        if (friendsToRemoveCount > 0) {
            // We have friends to remove, find people with fewest trades and remove them
            const friendsWithTrades = this.bot.trades.getTradesWithPeople(friends);

            // Ignore friends to keep
            this.friendsToKeep.forEach(steamID => delete friendsWithTrades[steamID]);

            if (steamIDToIgnore) {
                delete friendsWithTrades[steamIDToIgnore.toString()];
            }

            // Convert object into an array so it can be sorted
            const tradesWithPeople: { steamID: string; trades: number }[] = [];
            for (const steamID in friendsWithTrades) {
                if (!Object.prototype.hasOwnProperty.call(friendsWithTrades, steamID)) {
                    continue;
                }
                tradesWithPeople.push({ steamID: steamID, trades: friendsWithTrades[steamID] });
            }

            // Sorts people by trades and picks people with lowest amounts of trades but not the 2 latest people
            const friendsToRemove = tradesWithPeople
                .sort((a, b) => a.trades - b.trades)
                .splice(1, friendsToRemoveCount - 2 <= 0 ? 2 : friendsToRemoveCount);

            log.info(`Cleaning up friendslist, removing ${friendsToRemove.length} people...`);
            friendsToRemove.forEach(friend => {
                const friendSteamID = friend.steamID;
                const getFriend = this.bot.friends.getFriend(friendSteamID);

                this.bot.sendMessage(
                    friendSteamID,
                    this.opt.customMessage.clearFriends
                        ? this.opt.customMessage.clearFriends.replace(
                              /%name%/g,
                              getFriend ? getFriend.player_name : friendSteamID
                          )
                        : '/quote I am cleaning up my friend list and you have randomly been selected to be removed. ' +
                              'Please feel free to add me again if you want to trade at a later time!'
                );
                this.bot.client.removeFriend(friendSteamID);
            });
        }
    }

    private getBPTFAccountInfo(): Promise<void> {
        return new Promise((resolve, reject) => {
            const steamID64 = this.bot.manager.steamID.getSteamID64();

            void request(
                {
                    url: 'https://backpack.tf/api/users/info/v1',
                    method: 'GET',
                    qs: {
                        key: this.opt.bptfAPIKey,
                        steamids: steamID64
                    },
                    gzip: true,
                    json: true
                },
                (err, reponse, body) => {
                    if (err) {
                        log.debug('Failed requesting bot info from backpack.tf, retrying in 5 minutes: ', err);
                        clearTimeout(this.retryRequest);

                        this.retryRequest = setTimeout(() => {
                            void this.getBPTFAccountInfo();
                        }, 5 * 60 * 1000);
                        return reject();
                    }

                    const thisBody = body as BPTFGetUserInfo;

                    const user = thisBody.users[steamID64];
                    this.botName = user.name;
                    this.botAvatarURL = user.avatar;
                    this.isPremium = user.premium ? user.premium === 1 : false;
                    return resolve();
                }
            );
        });
    }

    private checkGroupInvites(): void {
        log.debug('Checking group invites');

        for (const groupID64 in this.bot.client.myGroups) {
            if (!Object.prototype.hasOwnProperty.call(this.bot.client.myGroups, groupID64)) {
                continue;
            }

            if ((this.bot.client.myGroups[groupID64] as number) === EClanRelationship.Invited) {
                // relation
                this.bot.client.respondToGroupInvite(groupID64, false);
            }
        }

        this.groups.forEach(steamID => {
            if (
                this.bot.client.myGroups[steamID] !== EClanRelationship.Member &&
                this.bot.client.myGroups[steamID] !== EClanRelationship.Blocked
            ) {
                this.bot.community.getSteamGroup(new SteamID(steamID), (err, group) => {
                    if (err) {
                        log.warn('Failed to get group: ', err);
                        return;
                    }

                    log.info(`Not member of group ${group.name} ("${steamID}"), joining...`);
                    group.join(err => {
                        if (err) {
                            log.warn('Failed to join group: ', err);
                        }
                    });
                });
            }
        });
    }

    onPollData(pollData: PollData): void {
        files.writeFile(this.paths.files.pollData, pollData, true).catch(err => {
            log.warn('Failed to save polldata: ', err);
        });
    }

    async onPricelist(pricelist: Entry[]): Promise<void> {
        if (pricelist.length === 0) {
            // Ignore errors
            await this.bot.listings.removeAll();
        }

        files
            .writeFile(
                this.paths.files.pricelist,
                pricelist.map(entry => entry.getJSON()),
                true
            )
            .catch(err => {
                log.warn('Failed to save pricelist: ', err);
            });
    }

    onPriceChange(sku: string, entry: Entry): void {
        if (!this.isPriceUpdateWebhook) {
            log.debug(`${sku} updated`);
        }
        this.bot.listings.checkBySKU(sku, entry, false, true);
    }

    onLoginThrottle(wait: number): void {
        log.warn(`Waiting ${wait} ms before trying to sign in...`);
    }

    onTF2QueueCompleted(): void {
        log.debug('Queue finished');
        this.bot.client.gamesPlayed(this.opt.miscSettings.game.playOnlyTF2 ? 440 : [this.customGameName, 440]);
    }

    onCreateListingsError(err: Error): void {
        log.error('Error on create listings:', err);
    }

    onDeleteListingsError(err: Error): void {
        log.error('Error on delete listings:', err);
    }
}

interface OnRun {
    loginAttempts?: number[];
    pricelist?: EntryData[];
    loginKey?: string;
    pollData?: PollData;
}

interface OnNewTradeOffer {
    action: 'accept' | 'decline' | 'skip';
    reason: string;
    meta?: Meta;
}

interface BotInfo {
    name: string;
    avatarURL: string;
    steamID: SteamID;
    premium: boolean;
}

interface GetHighValue {
    our: Which;
    their: Which;
}

interface Which {
    items: Record<string, any>;
    isMention: boolean;
}
