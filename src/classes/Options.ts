import { snakeCase } from 'change-case';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'fs';
import jsonlint from 'jsonlint';
import * as path from 'path';
import { deepMerge } from '../lib/tools/deep-merge';
import validator from '../lib/validator';
import { Currency } from '../types/TeamFortress2';

export const DEFAULTS = {
    miscSettings: {
        showOnlyMetal: {
            enable: true
        },
        sortInventory: {
            enable: true,
            type: 3
        },
        createListings: {
            enable: true
        },
        addFriends: {
            enable: true
        },
        sendGroupInvite: {
            enable: true
        },
        autobump: {
            enable: true
        },
        skipItemsInTrade: {
            enable: true
        },
        weaponsAsCurrency: {
            enable: true,
            withUncraft: true
        },
        checkUses: {
            duel: true,
            noiseMaker: true
        },
        game: {
            playOnlyTF2: false,
            customName: 'TF2Autobot'
        }
    },

    sendAlert: {
        enable: true,
        autokeys: {
            lowPure: true,
            failedToAdd: true,
            failedToUpdate: true,
            failedToDisable: true
        },
        backpackFull: true,
        highValue: {
            gotDisabled: true,
            receivedNotInPricelist: true,
            tryingToTake: true
        },
        autoRemoveIntentSellFailed: true,
        autoAddPaintedItems: true,
        failedAccept: true,
        unableToProcessOffer: true,
        partialPrice: {
            onUpdate: true,
            onSuccessUpdatePartialPriced: true,
            onFailedUpdatePartialPriced: true,
            onBulkUpdatePartialPriced: true,
            onResetAfterThreshold: true
        },
        receivedUnusualNotInPricelist: true,
        failedToUpdateOldPrices: true
    },

    pricelist: {
        partialPriceUpdate: {
            enable: false,
            thresholdInSeconds: 604800, // 7 days
            excludeSKU: []
        },
        filterCantAfford: {
            enable: false
        },
        autoRemoveIntentSell: {
            enable: false
        },
        autoAddInvalidItems: {
            enable: true
        },
        autoAddInvalidUnusual: {
            enable: false
        },
        autoAddPaintedItems: {
            enable: true
        },
        priceAge: {
            maxInSeconds: 28800
        }
    },

    bypass: {
        escrow: {
            allow: false
        },
        overpay: {
            allow: true
        },
        giftWithoutMessage: {
            allow: false
        },
        bannedPeople: {
            allow: false
        }
    },

    tradeSummary: {
        showStockChanges: false,
        showTimeTakenInMS: false,
        showDetailedTimeTaken: true,
        showItemPrices: true,
        showPureInEmoji: false,
        showProperName: false,
        customText: {
            summary: {
                steamChat: 'Summary',
                discordWebhook: '__**Summary**__'
            },
            asked: {
                steamChat: '• Asked:',
                discordWebhook: '**• Asked:**'
            },
            offered: {
                steamChat: '• Offered:',
                discordWebhook: '**• Offered:**'
            },
            profitFromOverpay: {
                steamChat: '📈 Profit from overpay:',
                discordWebhook: '📈 ***Profit from overpay:***'
            },
            lossFromUnderpay: {
                steamChat: '📉 Loss from underpay:',
                discordWebhook: '📉 ***Loss from underpay:***'
            },
            timeTaken: {
                steamChat: '⏱ Time taken:',
                discordWebhook: '⏱ **Time taken:**'
            },
            keyRate: {
                steamChat: '🔑 Key rate:',
                discordWebhook: '🔑 Key rate:'
            },
            pureStock: {
                steamChat: '💰 Pure stock:',
                discordWebhook: '💰 Pure stock:'
            },
            totalItems: {
                steamChat: '🎒 Total items:',
                discordWebhook: '🎒 Total items:'
            },
            spells: '🎃 Spells:',
            strangeParts: '🎰 Parts:',
            killstreaker: '🔥 Killstreaker:',
            sheen: '✨ Sheen:',
            painted: '🎨 Painted:'
        }
    },

    steamChat: {
        customInitializer: {
            acceptedTradeSummary: '/me',
            review: '',
            message: {
                onReceive: '/quote',
                toOtherAdmins: '/quote'
                // toTradePartner is in commands.message.customReply.fromOwner
            }
        }
    },

    highValue: {
        enableHold: true,
        spells: [],
        sheens: [],
        killstreakers: [],
        strangeParts: [],
        painted: []
    },

    normalize: {
        festivized: {
            our: false,
            their: false
        },
        strangeAsSecondQuality: {
            our: false,
            their: false
        },
        painted: {
            our: true,
            their: true
        }
    },

    details: {
        buy: 'I am buying your %name% for %price%, I have %current_stock% / %max_stock%.',
        sell: 'I am selling my %name% for %price%, I am selling %amount_trade%.',
        highValue: {
            showSpells: true,
            showStrangeParts: false,
            showKillstreaker: true,
            showSheen: true,
            showPainted: true,
            customText: {
                spells: '🎃 Spells:',
                strangeParts: '🎰 Parts:',
                killstreaker: '🤩 Killstreaker:',
                sheen: '✨ Sheen:',
                painted: '🎨 Painted:',
                separator: '| ',
                ender: ' |'
            }
        },
        uses: {
            duel: '(𝗢𝗡𝗟𝗬 𝗪𝗜𝗧𝗛 𝟱x 𝗨𝗦𝗘𝗦)',
            noiseMaker: '(𝗢𝗡𝗟𝗬 𝗪𝗜𝗧𝗛 𝟐𝟱x 𝗨𝗦𝗘𝗦)'
        }
    },

    statistics: {
        lastTotalTrades: 0,
        startingTimeInUnix: 0,
        lastTotalProfitMadeInRef: 0,
        lastTotalProfitOverpayInRef: 0,
        profitDataSinceInUnix: 0,
        sendStats: {
            enable: false,
            time: []
        }
    },

    autokeys: {
        enable: false,
        minKeys: 3,
        maxKeys: 15,
        minRefined: 30,
        maxRefined: 150,
        banking: {
            enable: false
        },
        scrapAdjustment: {
            enable: false,
            value: 1
        },
        accept: {
            understock: false
        }
    },

    crafting: {
        weapons: {
            enable: true
        },
        metals: {
            enable: true,
            minScrap: 9,
            minRec: 9,
            threshold: 9
        }
    },

    offerReceived: {
        sendPreAcceptMessage: {
            enable: true
        },
        alwaysDeclineNonTF2Items: true,
        // 🟥_INVALID_VALUE
        invalidValue: {
            autoDecline: {
                enable: true,
                declineReply: ''
            },
            exceptionValue: {
                skus: [],
                valueInRef: 0
            }
        },
        // 🟨_INVALID_ITEMS
        invalidItems: {
            givePrice: false,
            autoAcceptOverpay: true,
            autoDecline: {
                enable: false,
                declineReply: ''
            }
        },
        // 🟧_DISABLED_ITEMS
        disabledItems: {
            autoAcceptOverpay: false,
            autoDecline: {
                enable: false,
                declineReply: ''
            }
        },
        // 🟦_OVERSTOCKED
        overstocked: {
            autoAcceptOverpay: false,
            autoDecline: {
                enable: false,
                declineReply: ''
            }
        },
        // 🟩_UNDERSTOCKED
        understocked: {
            autoAcceptOverpay: false,
            autoDecline: {
                enable: false,
                declineReply: ''
            }
        },
        // 🟫_DUPED_ITEMS
        duped: {
            enableCheck: true,
            minKeys: 10,
            autoDecline: {
                enable: false,
                declineReply: ''
            }
        },
        // ⬜_ESCROW_CHECK_FAILED
        escrowCheckFailed: {
            ignoreFailed: false
        },
        // ⬜_BANNED_CHECK_FAILED
        bannedCheckFailed: {
            ignoreFailed: false
        }
    },

    manualReview: {
        enable: true,
        showOfferSummary: true,
        showReviewOfferNote: true,
        showOwnerCurrentTime: true,
        showItemPrices: true,
        // 🟥_INVALID_VALUE
        invalidValue: {
            note: ''
        },
        // 🟨_INVALID_ITEMS
        invalidItems: {
            note: ''
        },
        // 🟧_DISABLED_ITEMS
        disabledItems: {
            note: ''
        },
        // 🟦_OVERSTOCKED
        overstocked: {
            note: ''
        },
        // 🟩_UNDERSTOCKED
        understocked: {
            note: ''
        },
        // 🟫_DUPED_ITEMS
        duped: {
            note: ''
        },
        // 🟪_DUPE_CHECK_FAILED
        dupedCheckFailed: {
            note: ''
        },
        // ⬜_ESCROW_CHECK_FAILED
        escrowCheckFailed: {
            note: ''
        },
        // ⬜_BANNED_CHECK_FAILED
        bannedCheckFailed: {
            note: ''
        },
        additionalNotes: ''
    },

    discordWebhook: {
        ownerID: '',
        displayName: '',
        avatarURL: '',
        embedColor: '9171753',
        tradeSummary: {
            enable: true,
            url: [],
            misc: {
                showQuickLinks: true,
                showKeyRate: true,
                showPureStock: true,
                showInventory: true,
                note: ''
            },
            mentionOwner: {
                enable: false,
                itemSkus: [],
                tradeValueInRef: 0
            }
        },
        offerReview: {
            enable: true,
            url: '',
            mentionInvalidValue: true,
            isMention: true,
            misc: {
                showQuickLinks: true,
                showKeyRate: true,
                showPureStock: true,
                showInventory: true
            }
        },
        messages: {
            enable: true,
            isMention: true,
            url: '',
            showQuickLinks: true
        },
        priceUpdate: {
            enable: true,
            showOnlyInStock: false,
            showFailedToUpdate: true,
            url: '',
            note: ''
        },
        sendAlert: {
            enable: true,
            isMention: true,
            url: ''
        },
        sendStats: {
            enable: false,
            url: ''
        }
    },

    customMessage: {
        sendOffer: '',
        welcome: '',
        iDontKnowWhatYouMean: '',
        success: '',
        successEscrow: '',
        decline: {
            general: '',
            hasNonTF2Items: '',
            giftNoNote: '',
            crimeAttempt: '',
            onlyMetal: '',
            duelingNot5Uses: '',
            noiseMakerNot25Uses: '',
            highValueItemsNotSelling: '',
            notTradingKeys: '',
            notSellingKeys: '',
            notBuyingKeys: '',
            banned: '',
            escrow: '',
            manual: ''
        },
        accepted: {
            automatic: {
                largeOffer: '',
                smallOffer: ''
            },
            manual: {
                largeOffer: '',
                smallOffer: ''
            }
        },
        tradedAway: '',
        failedMobileConfirmation: '',
        cancelledActiveForAwhile: '',
        clearFriends: ''
    },

    commands: {
        enable: true,
        customDisableReply: '',
        how2trade: {
            customReply: {
                reply: ''
            }
        },
        price: {
            enable: true,
            customReply: {
                disabled: ''
            }
        },
        buy: {
            enable: true,
            disableForSKU: [],
            customReply: {
                disabled: '',
                disabledForSKU: ''
            }
        },
        sell: {
            enable: true,
            disableForSKU: [],
            customReply: {
                disabled: '',
                disabledForSKU: ''
            }
        },
        buycart: {
            enable: true,
            disableForSKU: [],
            customReply: {
                disabled: '',
                disabledForSKU: ''
            }
        },
        sellcart: {
            enable: true,
            disableForSKU: [],
            customReply: {
                disabled: '',
                disabledForSKU: ''
            }
        },
        cart: {
            enable: true,
            customReply: {
                title: '',
                disabled: ''
            }
        },
        clearcart: {
            // always enable
            customReply: {
                reply: ''
            }
        },
        checkout: {
            // always enable
            customReply: {
                empty: ''
            }
        },
        addToQueue: {
            alreadyHaveActiveOffer: '',
            alreadyInQueueProcessingOffer: '',
            alreadyInQueueWaitingTurn: '',
            addedToQueueWaitingTurn: '',
            alteredOffer: '',
            processingOffer: {
                donation: '',
                isBuyingPremium: '',
                offer: ''
            },
            hasBeenMadeAcceptingMobileConfirmation: {
                donation: '',
                isBuyingPremium: '',
                offer: ''
            }
        },
        cancel: {
            // always enable
            customReply: {
                isBeingSent: '',
                isCancelling: '',
                isRemovedFromQueue: '',
                noActiveOffer: '',
                successCancel: ''
            }
        },
        queue: {
            // always enable
            customReply: {
                notInQueue: '',
                offerBeingMade: '',
                hasPosition: ''
            }
        },
        owner: {
            enable: true,
            customReply: {
                disabled: '',
                reply: ''
            }
        },
        discord: {
            enable: true,
            inviteURL: '',
            customReply: {
                disabled: '',
                reply: ''
            }
        },
        more: {
            enable: true,
            customReply: {
                disabled: ''
            }
        },
        autokeys: {
            enable: true,
            customReply: {
                disabled: ''
            }
        },
        message: {
            enable: true,
            showOwnerName: true,
            customReply: {
                disabled: '',
                wrongSyntax: '',
                fromOwner: '',
                success: ''
            }
        },
        time: {
            enable: true,
            customReply: {
                disabled: '',
                reply: ''
            }
        },
        uptime: {
            enable: true,
            customReply: {
                disabled: '',
                reply: ''
            }
        },
        pure: {
            enable: true,
            customReply: {
                disabled: '',
                reply: ''
            }
        },
        rate: {
            enable: true,
            customReply: {
                disabled: '',
                reply: ''
            }
        },
        stock: {
            enable: true,
            maximumItems: 20,
            customReply: {
                disabled: '',
                reply: ''
            }
        },
        craftweapon: {
            enable: true,
            customReply: {
                disabled: '',
                dontHave: '',
                have: ''
            }
        },
        uncraftweapon: {
            enable: true,
            customReply: {
                disabled: '',
                dontHave: '',
                have: ''
            }
        }
    },

    detailsExtra: {
        /**
         * Custom string to be shown in listing note if details.highValue.showSpells set to true
         */
        spells: {
            'Putrescent Pigmentation': 'PP 🍃',
            'Die Job': 'DJ 🍐',
            'Chromatic Corruption': 'CC 🪀',
            'Spectral Spectrum': 'Spec 🔵🔴',
            'Sinister Staining': 'Sin 🍈',
            'Voices From Below': 'VFB 🗣️',
            'Team Spirit Footprints': 'TS-FP 🔵🔴',
            'Gangreen Footprints': 'GG-FP 🟡',
            'Corpse Gray Footprints': 'CG-FP 👽',
            'Violent Violet Footprints': 'VV-FP ♨️',
            'Rotten Orange Footprints': 'RO-FP 🍊',
            'Bruised Purple Footprints': 'BP-FP 🍷',
            'Headless Horseshoes': 'HH 🍇',
            Exorcism: '👻',
            'Pumpkin Bombs': '🎃💣',
            'Halloween Fire': '🔥🟢'
        },
        /**
         * Custom string to be shown in listing note if details.highValue.showSheen set to true
         */
        sheens: {
            'Team Shine': '🔵🔴',
            'Hot Rod': '🌸',
            Manndarin: '🟠',
            'Deadly Daffodil': '🟡',
            'Mean Green': '🟢',
            'Agonizing Emerald': '🟩',
            'Villainous Violet': '🟣'
        },
        /**
         * Custom string to be shown in listing note if details.highValue.showKillstreaker set to true
         */
        killstreakers: {
            'Cerebral Discharge': '⚡',
            'Fire Horns': '🔥🐮',
            Flames: '🔥',
            'Hypno-Beam': '😵💫',
            Incinerator: '🚬',
            Singularity: '🔆',
            Tornado: '🌪️'
        },
        /**
         * painted.stringNote: Custom string to be shown in listing note if details.highValue.showPainted set to true
         * painted.price: Paint price to be added with the item base price to automatically create sell order for painted items.
         */
        painted: {
            'A Color Similar to Slate': {
                stringNote: '🧪',
                price: {
                    keys: 0,
                    metal: 11
                }
            },
            'A Deep Commitment to Purple': {
                stringNote: '🪀',
                price: {
                    keys: 0,
                    metal: 15
                }
            },
            'A Distinctive Lack of Hue': {
                stringNote: '🎩',
                price: {
                    keys: 1,
                    metal: 5
                }
            },
            "A Mann's Mint": {
                stringNote: '👽',
                price: {
                    keys: 0,
                    metal: 30
                }
            },
            'After Eight': {
                stringNote: '🏴',
                price: {
                    keys: 1,
                    metal: 5
                }
            },
            'Aged Moustache Grey': {
                stringNote: '👤',
                price: {
                    keys: 0,
                    metal: 5
                }
            },
            'An Extraordinary Abundance of Tinge': {
                stringNote: '🏐',
                price: {
                    keys: 1,
                    metal: 5
                }
            },
            'Australium Gold': {
                stringNote: '🏆',
                price: {
                    keys: 0,
                    metal: 15
                }
            },
            'Color No. 216-190-216': {
                stringNote: '🧠',
                price: {
                    keys: 0,
                    metal: 7
                }
            },
            'Dark Salmon Injustice': {
                stringNote: '🐚',
                price: {
                    keys: 0,
                    metal: 15
                }
            },
            'Drably Olive': {
                stringNote: '🥝',
                price: {
                    keys: 0,
                    metal: 5
                }
            },
            'Indubitably Green': {
                stringNote: '🥦',
                price: {
                    keys: 0,
                    metal: 5
                }
            },
            'Mann Co. Orange': {
                stringNote: '🏀',
                price: {
                    keys: 0,
                    metal: 6
                }
            },
            Muskelmannbraun: {
                stringNote: '👜',
                price: {
                    keys: 0,
                    metal: 2
                }
            },
            "Noble Hatter's Violet": {
                stringNote: '🍇',
                price: {
                    keys: 0,
                    metal: 7
                }
            },
            'Peculiarly Drab Tincture': {
                stringNote: '🪑',
                price: {
                    keys: 0,
                    metal: 3
                }
            },
            'Pink as Hell': {
                stringNote: '🎀',
                price: {
                    keys: 1,
                    metal: 10
                }
            },
            'Radigan Conagher Brown': {
                stringNote: '🚪',
                price: {
                    keys: 0,
                    metal: 2
                }
            },
            'The Bitter Taste of Defeat and Lime': {
                stringNote: '💚',
                price: {
                    keys: 1,
                    metal: 10
                }
            },
            "The Color of a Gentlemann's Business Pants": {
                stringNote: '🧽',
                price: {
                    keys: 0,
                    metal: 5
                }
            },
            'Ye Olde Rustic Colour': {
                stringNote: '🥔',
                price: {
                    keys: 0,
                    metal: 2
                }
            },
            "Zepheniah's Greed": {
                stringNote: '🌳',
                price: {
                    keys: 0,
                    metal: 4
                }
            },
            'An Air of Debonair': {
                stringNote: '👜🔷',
                price: {
                    keys: 0,
                    metal: 30
                }
            },
            'Balaclavas Are Forever': {
                stringNote: '👜🔷',
                price: {
                    keys: 0,
                    metal: 30
                }
            },
            "Operator's Overalls": {
                stringNote: '👜🔷',
                price: {
                    keys: 0,
                    metal: 30
                }
            },
            'Cream Spirit': {
                stringNote: '🍘🥮',
                price: {
                    keys: 0,
                    metal: 30
                }
            },
            'Team Spirit': {
                stringNote: '🔵🔴',
                price: {
                    keys: 0,
                    metal: 30
                }
            },
            'The Value of Teamwork': {
                stringNote: '🎎',
                price: {
                    keys: 0,
                    metal: 30
                }
            },
            'Waterlogged Lab Coat': {
                stringNote: '🎏',
                price: {
                    keys: 0,
                    metal: 30
                }
            },
            'Legacy Paint': {
                stringNote: '🔵⛔',
                price: {
                    keys: 4,
                    metal: 0
                }
            }
        },
        /**
         * Custom string to be shown in listing note if details.highValue.showStrangeParts set to true
         */
        strangeParts: {
            'Robots Destroyed': '',
            Kills: '',
            'Airborne Enemy Kills': '',
            'Damage Dealt': '',
            Dominations: '',
            'Snipers Killed': '',
            'Buildings Destroyed': '',
            'Projectiles Reflected': '',
            'Headshot Kills': '',
            'Medics Killed': '',
            'Fires Survived': '',
            'Teammates Extinguished': '',
            'Freezecam Taunt Appearances': '',
            'Spies Killed': '',
            'Allied Healing Done': '',
            'Sappers Removed': '',
            'Players Hit': '',
            'Gib Kills': '',
            'Scouts Killed': '',
            'Taunt Kills': '',
            'Point Blank Kills': '',
            'Soldiers Killed': '',
            'Long-Distance Kills': '',
            'Giant Robots Destroyed': '',
            'Critical Kills': '',
            'Demomen Killed': '',
            'Unusual-Wearing Player Kills': '',
            Assists: '',
            'Medics Killed That Have Full ÜberCharge': '',
            'Cloaked Spies Killed': '',
            'Engineers Killed': '',
            'Kills While Explosive-Jumping': '',
            'Kills While Low Health': '',
            'Burning Player Kills': '',
            'Kills While Invuln ÜberCharged': '',
            'Posthumous Kills': '',
            'Not Crit nor MiniCrit Kills': '',
            'Full Health Kills': '',
            'Killstreaks Ended': '',
            'Defenders Killed': '',
            Revenges: '',
            'Robot Scouts Destroyed': '',
            'Heavies Killed': '',
            'Tanks Destroyed': '',
            'Kills During Halloween': '',
            'Pyros Killed': '',
            'Submerged Enemy Kills': '',
            'Kills During Victory Time': '',
            'Taunting Player Kills': '',
            'Robot Spies Destroyed': '',
            'Kills Under A Full Moon': '',
            'Robots Killed During Halloween': ''
        }
    }
};

interface OnlyEnable {
    enable?: boolean;
}

// ------------ SortType ------------

interface SortInventory extends OnlyEnable {
    type?: number;
}

// ------------ WeaponsAsCurrency ------------

interface WeaponsAsCurrency extends OnlyEnable {
    withUncraft?: boolean;
}

// ------------ CheckUses ------------

interface CheckUses {
    duel?: boolean;
    noiseMaker?: boolean;
}

// ------------ Game ------------

interface Game {
    playOnlyTF2?: boolean;
    customName?: string;
}

// --------- Misc Settings ----------

interface MiscSettings {
    showOnlyMetal?: OnlyEnable;
    sortInventory?: SortInventory;
    createListings?: OnlyEnable;
    addFriends?: OnlyEnable;
    sendGroupInvite?: OnlyEnable;
    autobump?: OnlyEnable;
    skipItemsInTrade?: OnlyEnable;
    weaponsAsCurrency?: WeaponsAsCurrency;
    checkUses?: CheckUses;
    game?: Game;
}

// ------------ SendAlert ------------

interface SendAlert extends OnlyEnable {
    autokeys?: AutokeysAlert;
    backpackFull?: boolean;
    highValue?: HighValueAlert;
    autoRemoveIntentSellFailed?: boolean;
    autoAddPaintedItems?: boolean;
    failedAccept?: boolean;
    unableToProcessOffer?: boolean;
    partialPrice?: PartialPrice;
    receivedUnusualNotInPricelist?: boolean;
    failedToUpdateOldPrices?: boolean;
}

interface PartialPrice {
    onUpdate?: boolean;
    onSuccessUpdatePartialPriced?: boolean;
    onFailedUpdatePartialPriced?: boolean;
    onBulkUpdatePartialPriced?: boolean;
    onResetAfterThreshold?: boolean;
}

interface AutokeysAlert {
    lowPure?: boolean;
    failedToAdd?: boolean;
    failedToUpdate?: boolean;
    failedToDisable?: boolean;
}

interface HighValueAlert {
    gotDisabled?: boolean;
    receivedNotInPricelist?: boolean;
    tryingToTake?: boolean;
}

// ------------ Pricelist ------------

interface Pricelist {
    partialPriceUpdate?: PartialPriceUpdate;
    filterCantAfford?: OnlyEnable;
    autoRemoveIntentSell?: OnlyEnable;
    autoAddInvalidItems?: OnlyEnable;
    autoAddInvalidUnusual?: OnlyEnable;
    autoAddPaintedItems?: OnlyEnable;
    priceAge?: PriceAge;
}

interface PartialPriceUpdate extends OnlyEnable {
    thresholdInSeconds?: number;
    excludeSKU?: string[];
}

interface PriceAge {
    maxInSeconds?: number;
}

// ------------ Bypass ------------

interface Bypass {
    escrow?: OnlyAllow;
    overpay?: OnlyAllow;
    giftWithoutMessage?: OnlyAllow;
    bannedPeople?: OnlyAllow;
}

interface OnlyAllow {
    allow?: boolean;
}

// ------------ TradeSummary ------------

export interface TradeSummary {
    showStockChanges?: boolean;
    showTimeTakenInMS?: boolean;
    showDetailedTimeTaken?: boolean;
    showItemPrices?: boolean;
    showPureInEmoji?: boolean;
    showProperName?: boolean;
    customText?: TradeSummaryCustomText;
}

interface TradeSummaryCustomText {
    summary: SteamDiscord;
    asked: SteamDiscord;
    offered: SteamDiscord;
    profitFromOverpay: SteamDiscord;
    lossFromUnderpay: SteamDiscord;
    timeTaken: SteamDiscord;
    keyRate: SteamDiscord;
    pureStock: SteamDiscord;
    totalItems: SteamDiscord;
    spells: string;
    strangeParts: string;
    killstreaker: string;
    sheen: string;
    painted: string;
}

interface SteamDiscord {
    steamChat?: string;
    discordWebhook?: string;
}

// ----------- Steam Chat ------------

interface SteamChat {
    customInitializer?: CustomInitializer;
}

interface CustomInitializer {
    acceptedTradeSummary?: string;
    review?: string;
    message?: CustomInitializerMessage;
}

interface CustomInitializerMessage {
    onReceive?: string;
    toOtherAdmins?: string;
}

// ------------ HighValue ------------

interface HighValue {
    enableHold?: boolean;
    spells?: string[];
    sheens?: string[];
    killstreakers?: string[];
    strangeParts?: string[];
    painted?: string[];
}

// ------------ Normalize ------------

interface Normalize {
    festivized?: NormalizeOurOrTheir;
    strangeAsSecondQuality?: NormalizeOurOrTheir;
    painted?: NormalizeOurOrTheir;
}

interface NormalizeOurOrTheir {
    our?: boolean;
    their?: boolean;
}

// ------------ Details ------------

interface Details {
    buy?: string;
    sell?: string;
    highValue?: ShowHighValue;
    uses?: UsesDetails;
}

interface ShowHighValue {
    showSpells?: boolean;
    showStrangeParts?: boolean;
    showKillstreaker?: boolean;
    showSheen?: boolean;
    showPainted?: boolean;
    customText?: HighValueCustomText;
}

interface HighValueCustomText {
    spells?: string;
    strangeParts?: string;
    killstreaker?: string;
    sheen?: string;
    painted?: string;
    separator?: string;
    ender?: string;
}

interface UsesDetails {
    duel?: string;
    noiseMaker?: string;
}

// ------------ Statistics ------------

interface Statistics {
    lastTotalTrades?: number;
    startingTimeInUnix?: number;
    lastTotalProfitMadeInRef?: number;
    lastTotalProfitOverpayInRef?: number;
    profitDataSinceInUnix?: number;
    sendStats?: SendStats;
}

interface SendStats extends OnlyEnable {
    time?: string[];
}

// ------------ Autokeys ------------

interface Autokeys {
    enable?: boolean;
    minKeys?: number;
    maxKeys?: number;
    minRefined?: number;
    maxRefined?: number;
    banking?: Banking;
    scrapAdjustment?: ScrapAdjustment;
    accept?: Accept;
}

interface Banking {
    enable?: boolean;
}

interface ScrapAdjustment {
    enable?: boolean;
    value?: number;
}

interface Accept {
    understock?: boolean;
}

// ------------ Crafting ------------

interface Crafting {
    weapons?: OnlyEnable;
    metals?: Metals;
}

interface Metals extends OnlyEnable {
    minScrap?: number;
    minRec?: number;
    threshold?: number;
}

// ------------ Offer Received ------------

interface OfferReceived {
    sendPreAcceptMessage?: OnlyEnable;
    alwaysDeclineNonTF2Items?: boolean;
    invalidValue?: InvalidValue;
    invalidItems?: InvalidItems;
    disabledItems?: AutoAcceptOverpayAndAutoDecline;
    overstocked?: AutoAcceptOverpayAndAutoDecline;
    understocked?: AutoAcceptOverpayAndAutoDecline;
    duped?: Duped;
    escrowCheckFailed?: EscrowBannedCheckFailed;
    bannedCheckFailed?: EscrowBannedCheckFailed;
}

interface DeclineReply extends OnlyEnable {
    declineReply?: string;
}

interface InvalidValue {
    autoDecline: DeclineReply;
    exceptionValue: ExceptionValue;
}

interface ExceptionValue {
    skus: string[];
    valueInRef: number;
}

interface AutoAcceptOverpayAndAutoDecline {
    autoAcceptOverpay?: boolean;
    autoDecline?: DeclineReply;
}

interface InvalidItems extends AutoAcceptOverpayAndAutoDecline {
    givePrice?: boolean;
}

interface Duped {
    enableCheck?: boolean;
    minKeys?: number;
    autoDecline?: DeclineReply;
}

interface EscrowBannedCheckFailed {
    ignoreFailed?: boolean;
}

// ------------ Manual Review ------------

interface ManualReview extends OnlyEnable {
    showOfferSummary?: boolean;
    showReviewOfferNote?: boolean;
    showOwnerCurrentTime?: boolean;
    showItemPrices?: boolean;
    invalidValue?: OnlyNote;
    invalidItems?: OnlyNote;
    disabledItems?: OnlyNote;
    overstocked?: OnlyNote;
    understocked?: OnlyNote;
    duped?: OnlyNote;
    dupedCheckFailed?: OnlyNote;
    escrowCheckFailed?: OnlyNote;
    bannedCheckFailed?: OnlyNote;
    additionalNotes?: string;
}

// ------------ Discord Webhook ------------

interface DiscordWebhook {
    ownerID?: string;
    displayName?: string;
    avatarURL?: string;
    embedColor?: string;
    tradeSummary?: TradeSummaryDW;
    offerReview?: OfferReviewDW;
    messages?: MessagesDW;
    priceUpdate?: PriceUpdateDW;
    sendAlert?: SendAlertStatsDW;
    sendStats?: SendStatsDW;
}

interface TradeSummaryDW extends OnlyEnable {
    url?: string[];
    misc?: MiscTradeSummary;
    mentionOwner?: MentionOwner;
}

interface OnlyNote {
    note?: string;
}

interface MiscTradeSummary extends OnlyNote {
    showQuickLinks?: boolean;
    showKeyRate?: boolean;
    showPureStock?: boolean;
    showInventory?: boolean;
}

interface MentionOwner extends OnlyEnable {
    itemSkus?: string[];
    tradeValueInRef?: number;
}

interface OfferReviewDW extends OnlyEnable {
    url?: string;
    mentionInvalidValue?: boolean;
    isMention?: boolean;
    misc?: MiscOfferReview;
}

interface MiscOfferReview {
    showQuickLinks?: boolean;
    showKeyRate?: boolean;
    showPureStock?: boolean;
    showInventory?: boolean;
}

interface MessagesDW extends OnlyEnable {
    url?: string;
    isMention?: boolean;
    showQuickLinks?: boolean;
}

interface PriceUpdateDW extends OnlyEnable, OnlyNote {
    showOnlyInStock?: boolean;
    showFailedToUpdate?: boolean;
    url?: string;
}

interface SendAlertStatsDW extends OnlyEnable {
    isMention?: boolean;
    url?: string;
}

interface SendStatsDW extends OnlyEnable {
    url?: string;
}

// ------------ Custom Message ------------

interface CustomMessage {
    sendOffer?: string;
    welcome?: string;
    iDontKnowWhatYouMean?: string;
    success?: string;
    successEscrow?: string;
    decline?: DeclineNote;
    accepted?: AcceptedNote;
    tradedAway?: string;
    failedMobileConfirmation?: string;
    cancelledActiveForAwhile?: string;
    clearFriends?: string;
}

interface DeclineNote {
    general?: string;
    hasNonTF2Items?: string;
    giftNoNote?: string;
    crimeAttempt?: string;
    onlyMetal?: string;
    duelingNot5Uses?: string;
    noiseMakerNot25Uses?: string;
    highValueItemsNotSelling?: string;
    notTradingKeys?: string;
    notSellingKeys?: string;
    notBuyingKeys?: string;
    banned?: string;
    escrow?: string;
    manual?: string;
}

interface AcceptedNote {
    automatic?: OfferType;
    manual?: OfferType;
}

interface OfferType {
    largeOffer: string;
    smallOffer: string;
}

// ------------ Commands ------------

interface OnlyCustomReplyWithDisabled {
    disabled?: string;
    reply?: string;
}

interface Commands extends OnlyEnable {
    customDisableReply?: string;
    how2trade?: How2Trade;
    price?: Price;
    buy?: SpecificOperation;
    sell?: SpecificOperation;
    buycart?: SpecificOperation;
    sellcart?: SpecificOperation;
    cart?: Cart;
    clearcart?: ClearCart;
    checkout?: Checkout;
    addToQueue?: AddToQueue;
    cancel?: Cancel;
    queue?: Queue;
    owner?: Owner;
    discord?: Discord;
    more?: More;
    autokeys?: AutokeysCommand;
    message?: Message;
    time?: Time;
    uptime?: Uptime;
    pure?: Pure;
    rate?: Rate;
    stock?: Stock;
    craftweapon?: Weapons;
    uncraftweapon?: Weapons;
}

interface SpecificOperation extends OnlyEnable {
    disableForSKU?: string[];
    customReply?: CustomReplyForSpecificOperation;
}

interface CustomReplyForSpecificOperation {
    disabled?: string;
    disabledForSKU?: string;
}

interface How2Trade {
    customReply?: Omit<OnlyCustomReplyWithDisabled, 'disabled'>;
}

interface Price extends OnlyEnable {
    customReply?: Omit<OnlyCustomReplyWithDisabled, 'reply'>;
}

interface Cart extends OnlyEnable {
    customReply?: CartCustom;
}

interface CartCustom extends Omit<OnlyCustomReplyWithDisabled, 'reply'> {
    title?: string;
}

interface ClearCart {
    customReply?: Omit<OnlyCustomReplyWithDisabled, 'disabled'>;
}

interface Checkout {
    customReply?: CheckoutReply;
}

interface CheckoutReply {
    empty?: string;
}

interface AddToQueue {
    alreadyHaveActiveOffer?: string;
    alreadyInQueueProcessingOffer?: string;
    alreadyInQueueWaitingTurn?: string;
    addedToQueueWaitingTurn?: string;
    alteredOffer?: string;
    processingOffer?: CartQueueProcessing;
    hasBeenMadeAcceptingMobileConfirmation?: CartQueueProcessing;
}

interface CartQueueProcessing {
    donation?: string;
    isBuyingPremium?: string;
    offer?: string;
}

interface Cancel {
    customReply?: CancelCustom;
}

interface CancelCustom {
    isBeingSent?: string;
    isCancelling?: string;
    isRemovedFromQueue?: string;
    noActiveOffer?: string;
    successCancel?: string;
}

interface Queue {
    customReply?: QueueCustom;
}

interface QueueCustom {
    notInQueue?: string;
    offerBeingMade?: string;
    hasPosition?: string;
}

interface Owner extends OnlyEnable {
    customReply?: OnlyCustomReplyWithDisabled;
}

export interface Discord extends OnlyEnable {
    customReply?: OnlyCustomReplyWithDisabled;
    inviteURL?: string;
}

interface More extends OnlyEnable {
    customReply?: Omit<OnlyCustomReplyWithDisabled, 'reply'>;
}

interface AutokeysCommand extends OnlyEnable {
    customReply?: Omit<OnlyCustomReplyWithDisabled, 'reply'>;
}

interface Message extends OnlyEnable {
    showOwnerName?: boolean;
    customReply?: MessageCustom;
}

interface MessageCustom {
    disabled?: string;
    wrongSyntax?: string;
    fromOwner?: string;
    success?: string;
}

interface Time extends OnlyEnable {
    customReply?: OnlyCustomReplyWithDisabled;
}

interface Uptime extends OnlyEnable {
    customReply?: OnlyCustomReplyWithDisabled;
}

interface Pure extends OnlyEnable {
    customReply?: OnlyCustomReplyWithDisabled;
}

interface Rate extends OnlyEnable {
    customReply?: OnlyCustomReplyWithDisabled;
}

export interface Stock extends OnlyEnable {
    customReply?: OnlyCustomReplyWithDisabled;
    maximumItems?: number;
}

interface Weapons extends OnlyEnable {
    customReply?: HaveOrNo;
}

interface HaveOrNo {
    disabled?: string;
    dontHave?: string;
    have?: string;
}

// ------------ Extra Details -----------

interface DetailsExtra {
    spells?: Spells;
    sheens?: Sheens;
    killstreakers?: Killstreakers;
    painted?: Painted;
    strangeParts?: StrangeParts;
}

interface Spells {
    'Putrescent Pigmentation'?: string;
    'Die Job'?: string;
    'Chromatic Corruption'?: string;
    'Spectral Spectrum'?: string;
    'Sinister Staining'?: string;
    'Voices From Below'?: string;
    'Team Spirit Footprints'?: string;
    'Gangreen Footprints'?: string;
    'Corpse Gray Footprints'?: string;
    'Violent Violet Footprints'?: string;
    'Rotten Orange Footprints'?: string;
    'Bruised Purple Footprints'?: string;
    'Headless Horseshoes'?: string;
    Exorcism?: string;
    'Pumpkin Bombs'?: string;
    'Halloween Fire'?: string;
}

interface Sheens {
    'Team Shine'?: string;
    'Hot Rod'?: string;
    Manndarin?: string;
    'Deadly Daffodil'?: string;
    'Mean Green'?: string;
    'Agonizing Emerald'?: string;
    'Villainous Violet'?: string;
}

interface Killstreakers {
    'Cerebral Discharge'?: string;
    'Fire Horns'?: string;
    Flames?: string;
    'Hypno-Beam'?: string;
    Incinerator?: string;
    Singularity?: string;
    Tornado?: string;
}

interface PaintedProperties {
    stringNote?: string;
    price?: Currency;
}

interface Painted {
    'A Color Similar to Slate'?: PaintedProperties;
    'A Deep Commitment to Purple'?: PaintedProperties;
    'A Distinctive Lack of Hue'?: PaintedProperties;
    "A Mann's Mint"?: PaintedProperties;
    'After Eight'?: PaintedProperties;
    'Aged Moustache Grey'?: PaintedProperties;
    'An Extraordinary Abundance of Tinge'?: PaintedProperties;
    'Australium Gold'?: PaintedProperties;
    'Color No. 216-190-216'?: PaintedProperties;
    'Dark Salmon Injustice'?: PaintedProperties;
    'Drably Olive'?: PaintedProperties;
    'Indubitably Green'?: PaintedProperties;
    'Mann Co. Orange'?: PaintedProperties;
    Muskelmannbraun?: PaintedProperties;
    "Noble Hatter's Violet"?: PaintedProperties;
    'Peculiarly Drab Tincture'?: PaintedProperties;
    'Pink as Hell'?: PaintedProperties;
    'Radigan Conagher Brown'?: PaintedProperties;
    'The Bitter Taste of Defeat and Lime'?: PaintedProperties;
    "The Color of a Gentlemann's Business Pants"?: PaintedProperties;
    'Ye Olde Rustic Colour'?: PaintedProperties;
    "Zepheniah's Greed"?: PaintedProperties;
    'An Air of Debonair'?: PaintedProperties;
    'Balaclavas Are Forever'?: PaintedProperties;
    "Operator's Overalls"?: PaintedProperties;
    'Cream Spirit'?: PaintedProperties;
    'Team Spirit'?: PaintedProperties;
    'The Value of Teamwork'?: PaintedProperties;
    'Waterlogged Lab Coat'?: PaintedProperties;
    'Legacy Paint'?: PaintedProperties;
}

export type PaintedNames =
    | 'A Color Similar to Slate'
    | 'A Deep Commitment to Purple'
    | 'A Distinctive Lack of Hue'
    | "A Mann's Mint"
    | 'After Eight'
    | 'Aged Moustache Grey'
    | 'An Extraordinary Abundance of Tinge'
    | 'Australium Gold'
    | 'Color No. 216-190-216'
    | 'Dark Salmon Injustice'
    | 'Drably Olive'
    | 'Indubitably Green'
    | 'Mann Co. Orange'
    | 'Muskelmannbraun'
    | "Noble Hatter's Violet"
    | 'Peculiarly Drab Tincture'
    | 'Pink as Hell'
    | 'Radigan Conagher Brown'
    | 'The Bitter Taste of Defeat and Lime'
    | "The Color of a Gentlemann's Business Pants"
    | 'Ye Olde Rustic Colour'
    | "Zepheniah's Greed"
    | 'An Air of Debonair'
    | 'Balaclavas Are Forever'
    | "Operator's Overalls"
    | 'Cream Spirit'
    | 'Team Spirit'
    | 'The Value of Teamwork'
    | 'Waterlogged Lab Coat'
    | 'Legacy Paint';

interface StrangeParts {
    'Robots Destroyed'?: string;
    Kills?: string;
    'Airborne Enemy Kills'?: string;
    'Damage Dealt'?: string;
    Dominations?: string;
    'Snipers Killed'?: string;
    'Buildings Destroyed'?: string;
    'Projectiles Reflected'?: string;
    'Headshot Kills'?: string;
    'Medics Killed'?: string;
    'Fires Survived'?: string;
    'Teammates Extinguished'?: string;
    'Freezecam Taunt Appearances'?: string;
    'Spies Killed'?: string;
    'Allied Healing Done'?: string;
    'Sappers Removed'?: string;
    'Players Hit'?: string;
    'Gib Kills'?: string;
    'Scouts Killed'?: string;
    'Taunt Kills'?: string;
    'Point Blank Kills'?: string;
    'Soldiers Killed'?: string;
    'Long-Distance Kills'?: string;
    'Giant Robots Destroyed'?: string;
    'Critical Kills'?: string;
    'Demomen Killed'?: string;
    'Unusual-Wearing Player Kills'?: string;
    Assists?: string;
    'Medics Killed That Have Full ÜberCharge'?: string;
    'Cloaked Spies Killed'?: string;
    'Engineers Killed': string;
    'Kills While Explosive-Jumping': string;
    'Kills While Low Health': string;
    'Burning Player Kills': string;
    'Kills While Invuln ÜberCharged': string;
    'Posthumous Kills'?: string;
    'Not Crit nor MiniCrit Kills'?: string;
    'Full Health Kills'?: string;
    'Killstreaks Ended'?: string;
    'Defenders Killed'?: string;
    Revenges?: string;
    'Robot Scouts Destroyed'?: string;
    'Heavies Killed'?: string;
    'Tanks Destroyed'?: string;
    'Kills During Halloween'?: string;
    'Pyros Killed'?: string;
    'Submerged Enemy Kills'?: string;
    'Kills During Victory Time'?: string;
    'Taunting Player Kills'?: string;
    'Robot Spies Destroyed'?: string;
    'Kills Under A Full Moon'?: string;
    'Robots Killed During Halloween'?: string;
}

// ------------ JsonOptions ------------

export interface JsonOptions {
    miscSettings?: MiscSettings;
    sendAlert?: SendAlert;
    pricelist?: Pricelist;
    bypass?: Bypass;
    tradeSummary?: TradeSummary;
    steamChat?: SteamChat;
    highValue?: HighValue;
    normalize?: Normalize;
    details?: Details;
    statistics?: Statistics;
    autokeys?: Autokeys;
    crafting?: Crafting;
    offerReceived?: OfferReceived;
    manualReview?: ManualReview;
    discordWebhook?: DiscordWebhook;
    customMessage?: CustomMessage;
    commands?: Commands;
    detailsExtra?: DetailsExtra;
}

export default interface Options extends JsonOptions {
    steamAccountName?: string;
    steamPassword?: string;
    steamSharedSecret?: string;
    steamIdentitySecret?: string;

    bptfAccessToken?: string;
    bptfAPIKey?: string;

    admins?: string[];
    keep?: string[];
    itemStatsWhitelist?: string[];
    groups?: string[];
    alerts?: string[];

    enableSocket?: boolean;
    customPricerApiToken?: string;
    customPricerUrl?: string;

    skipBPTFTradeofferURL?: boolean;
    skipUpdateProfileSettings?: boolean;

    timezone?: string;
    customTimeFormat?: string;
    timeAdditionalNotes?: string;

    debug?: boolean;
    debugFile?: boolean;

    folderName?: string;
    filePrefix?: string;

    enableHttpApi?: boolean;
    httpApiPort?: number;
}

function getOption<T>(option: string, def: T, parseFn: (target: string) => T, options?: Options): T {
    try {
        if (options && options[option]) {
            return options[option] as T;
        }
        const envVar = snakeCase(option).toUpperCase();
        return process.env[envVar] ? parseFn(process.env[envVar]) : def;
    } catch {
        return def;
    }
}

function throwLintError(filepath: string, e: Error): void {
    if (e instanceof Error && 'message' in e) {
        throw new Error(`${filepath}\n${e.message}`);
    }

    throw e;
}

function lintPath(filepath: string): void {
    const rawOptions = readFileSync(filepath, { encoding: 'utf8' });
    try {
        jsonlint.parse(rawOptions);
    } catch (e) {
        throwLintError(filepath, e);
    }
}

function lintAllTheThings(directory: string): void {
    if (existsSync(directory)) {
        readdirSync(directory, { withFileTypes: true })
            .filter(ent => path.extname(ent.name) === '.json')
            .forEach(ent => lintPath(path.join(directory, ent.name)));
    }
}

function loadJsonOptions(optionsPath: string, options?: Options): JsonOptions {
    let fileOptions;
    const workingDefault = deepMerge({}, DEFAULTS);
    const incomingOptions = options ? deepMerge({}, options) : deepMerge({}, DEFAULTS);

    try {
        const rawOptions = readFileSync(optionsPath, { encoding: 'utf8' });
        try {
            fileOptions = deepMerge({}, workingDefault, JSON.parse(rawOptions));
            return deepMerge(fileOptions, incomingOptions);
        } catch (e) {
            if (e instanceof SyntaxError) {
                // lint the rawOptions to give better feedback since it is SyntaxError
                try {
                    jsonlint.parse(rawOptions);
                } catch (e) {
                    throwLintError(optionsPath, e);
                }
            }
            throw e;
        }
    } catch (e) {
        // file or directory is missing or something else is wrong
        if (!existsSync(path.dirname(optionsPath))) {
            // check for dir
            mkdirSync(path.dirname(optionsPath), { recursive: true });
            writeFileSync(optionsPath, JSON.stringify(DEFAULTS, null, 4), { encoding: 'utf8' });
            return deepMerge({}, DEFAULTS);
        } else if (!existsSync(optionsPath)) {
            // directory is present, see if file was missing
            writeFileSync(optionsPath, JSON.stringify(DEFAULTS, null, 4), { encoding: 'utf8' });
            return deepMerge({}, DEFAULTS);
        } else {
            // something else is wrong, throw the error
            throw e;
        }
    }
}

export function removeCliOptions(incomingOptions: Options): void {
    const findNonEnv = validator(incomingOptions, 'options');
    if (findNonEnv) {
        findNonEnv
            .filter(e => e.includes('unknown property'))
            .map(e => e.slice(18, -1))
            .map(e => delete incomingOptions[e]);
    }
}

export function loadOptions(options?: Options): Options {
    const incomingOptions = options ? deepMerge({}, options) : {};
    const steamAccountName = getOption('steamAccountName', '', String, incomingOptions);
    lintAllTheThings(getFilesPath(steamAccountName)); // you shall not pass

    const jsonParseArray = (jsonString: string): string[] => (JSON.parse(jsonString) as unknown) as string[];
    const jsonParseBoolean = (jsonString: string): boolean => (JSON.parse(jsonString) as unknown) as boolean;
    const jsonParseNumber = (jsonString: string): number => (JSON.parse(jsonString) as unknown) as number;

    const envOptions = {
        steamAccountName: steamAccountName,
        steamPassword: getOption('steamPassword', '', String, incomingOptions),
        steamSharedSecret: getOption('steamSharedSecret', '', String, incomingOptions),
        steamIdentitySecret: getOption('steamIdentitySecret', '', String, incomingOptions),

        bptfAccessToken: getOption('bptfAccessToken', '', String, incomingOptions),
        bptfAPIKey: getOption('bptfAPIKey', '', String, incomingOptions),

        admins: getOption('admins', [], jsonParseArray, incomingOptions),
        keep: getOption('keep', [], jsonParseArray, incomingOptions),
        itemStatsWhitelist: getOption('itemStatsWhitelist', [], jsonParseArray, incomingOptions),
        groups: getOption('groups', ['103582791469033930'], jsonParseArray, incomingOptions),
        alerts: getOption('alerts', ['trade'], jsonParseArray, incomingOptions),

        enableSocket: getOption('enableSocket', true, jsonParseBoolean, incomingOptions),
        customPricerApiToken: getOption('customPricerApiToken', '', String, incomingOptions),
        customPricerUrl: getOption('customPricerUrl', 'https://api.prices.tf', String, incomingOptions),

        skipBPTFTradeofferURL: getOption('skipBPTFTradeofferURL', true, jsonParseBoolean, incomingOptions),
        skipUpdateProfileSettings: getOption('skipUpdateProfileSettings', true, jsonParseBoolean, incomingOptions),

        timezone: getOption('timezone', '', String, incomingOptions),
        customTimeFormat: getOption('customTimeFormat', '', String, incomingOptions),
        timeAdditionalNotes: getOption('timeAdditionalNotes', '', String, incomingOptions),

        debug: getOption('debug', true, jsonParseBoolean, incomingOptions),
        debugFile: getOption('debugFile', true, jsonParseBoolean, incomingOptions),

        enableHttpApi: getOption('enableHttpApi', false, jsonParseBoolean, incomingOptions),
        httpApiPort: getOption('httpApiPort', 3001, jsonParseNumber, incomingOptions)
    };

    if (!envOptions.steamAccountName) {
        throw new Error('STEAM_ACCOUNT_NAME must be set in the environment');
    }

    removeCliOptions(incomingOptions);
    const jsonOptions = loadJsonOptions(getOptionsPath(envOptions.steamAccountName), incomingOptions);

    const errors = validator(jsonOptions, 'options');
    if (errors !== null) {
        throw new Error(errors.join(', '));
    }

    return deepMerge(jsonOptions, envOptions, incomingOptions);
}

export function getFilesPath(accountName: string): string {
    return path.resolve(__dirname, '..', '..', 'files', accountName);
}

export function getOptionsPath(accountName: string): string {
    return path.resolve(getFilesPath(accountName), 'options.json');
}
