/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */

// https://gist.github.com/mir4ef/c172583bdb968951d9e57fb50d44c3f7
interface O {
    (item: any): boolean;
}

interface AnyObject {
    [key: string]: any;
}

interface DeepMerge {
    (optCommand: boolean, target: AnyObject, ...sources: AnyObject[]): AnyObject;
}

/**
 * Method to check if an item is an object. Date and Function are considered
 * an object, so if you need to exclude those, please update the method accordingly.
 * @param item - The item that needs to be checked
 *
 */
export const isObject: O = (item: any): boolean => {
    return item === Object(item) && !Array.isArray(item);
};

export const deepMerge: DeepMerge = (optCommand: boolean, target: AnyObject, ...sources: AnyObject[]): AnyObject => {
    // return the target if no sources passed
    if (!sources.length) {
        return target;
    }

    const result: AnyObject = target;

    if (isObject(result)) {
        const len: number = sources.length;

        for (let i = 0; i < len; i += 1) {
            const elm: any = sources[i];

            if (optCommand) {
                // eslint-disable-next-line no-console
                console.log('deepMerge - elm', {
                    elm
                });
            }

            if (isObject(elm)) {
                for (const key in elm) {
                    // eslint-disable-next-line no-prototype-builtins
                    if (elm.hasOwnProperty(key)) {
                        if (isObject(elm[key])) {
                            if (!result[key] || !isObject(result[key])) {
                                result[key] = {};
                            }

                            if (optCommand) {
                                // eslint-disable-next-line no-console
                                console.log('old', {
                                    'result[key]': result[key],
                                    'elm[key]': elm[key]
                                });

                                const firstResultKey = result[key];
                                const firstResultKeyKeys = Object.keys(firstResultKey);
                                const firstResultKeyValues = Object.values(firstResultKey);
                                const firstResultKeyValuesCount = firstResultKeyValues.length;

                                const firstElmKey = elm[key];
                                const firstElmKeyKeys = Object.keys(firstElmKey);
                                const firstElmKeyValues = Object.values(firstElmKey);
                                const firstElmKeyValuesCount = firstElmKeyValues.length;

                                // eslint-disable-next-line no-console
                                console.log('info', {
                                    fistResultKey: firstResultKey,
                                    fistResultKeyKeys: firstResultKeyKeys,
                                    firstResultKeyValues: firstResultKeyValues,
                                    firstResultKeyValuesCount: firstResultKeyValuesCount,
                                    firstElmKey: firstElmKey,
                                    firstElmKeyKeys: firstElmKeyKeys,
                                    firstElmKeyValues: firstElmKeyValues,
                                    firstElmKeyValuesCount: firstElmKeyValuesCount
                                });

                                for (let i = 0; i < firstResultKeyValuesCount; i++) {
                                    // First degree
                                    const firstDegreeValue = firstElmKeyValues[i] || firstElmKeyValues[0];
                                    const firstDegreeValueKey = Object.keys(firstElmKey)[firstElmKeyValues[i] ? i : 0];

                                    // eslint-disable-next-line no-console
                                    console.log('First degree', {
                                        firstDegreeValue: firstDegreeValue,
                                        firstDegreeValueKey: firstDegreeValueKey
                                    });

                                    if (
                                        Array.isArray(firstDegreeValue) &&
                                        (firstDegreeValue as string[]).length === 0
                                    ) {
                                        if (isObject(firstResultKey)) {
                                            for (const resultKey in firstResultKey) {
                                                if (
                                                    firstElmKeyKeys[i] === resultKey &&
                                                    !isObject(resultKey) &&
                                                    Array.isArray(firstResultKey[resultKey])
                                                ) {
                                                    firstResultKey[resultKey].length = 0;
                                                }
                                            }
                                        } else {
                                            // Zero degree
                                            firstResultKey.length = 0;
                                        }
                                    } else if (isObject(firstDegreeValue)) {
                                        // Second degree

                                        const secondResultKey = firstResultKey[firstDegreeValueKey];
                                        const secondResultKeyKeys = Object.keys(secondResultKey);
                                        const secondResultKeyValues = Object.values(secondResultKey);
                                        const secondResultKeyValuesCount = secondResultKeyValues.length;

                                        const secondElmKey = firstDegreeValue;
                                        const secondElmKeyKeys = Object.keys(secondElmKey);
                                        const secondElmKeyValues = Object.values(secondElmKey);
                                        const secondElmKeyValuesCount = secondElmKeyValues.length;

                                        // eslint-disable-next-line no-console
                                        console.log('info', {
                                            secondResultKey: secondResultKey,
                                            secondResultKeyKeys: secondResultKeyKeys,
                                            secondResultKeyValues: secondResultKeyValues,
                                            secondResultKeyValuesCount: secondResultKeyValuesCount,
                                            secondElmKey: secondElmKey,
                                            secondElmKeyKeys: secondElmKeyKeys,
                                            secondElmKeyValues: secondElmKeyValues,
                                            secondElmKeyValuesCount: secondElmKeyValuesCount
                                        });

                                        for (let j = 0; j < secondResultKeyValuesCount; j++) {
                                            // Second degree
                                            const secondDegreeValue = secondElmKeyKeys[j] || secondElmKeyKeys[0];
                                            const secondDegreeValueKey = Object.keys(secondElmKey)[
                                                secondElmKeyKeys[j] ? j : 0
                                            ];

                                            // eslint-disable-next-line no-console
                                            console.log('Second degree', {
                                                secondDegreeValue: secondDegreeValue,
                                                secondDegreeValueKey: secondDegreeValueKey,
                                                isTrue1: Array.isArray(secondDegreeValue),
                                                isTrue2: ((secondDegreeValue as unknown) as string[]).length === 0
                                            });

                                            if (
                                                Array.isArray(secondDegreeValue) &&
                                                (secondDegreeValue as string[]).length === 0
                                            ) {
                                                if (isObject(secondResultKey)) {
                                                    const secondDegree = result[key][secondResultKeyKeys[j]];

                                                    for (const resultKey in secondDegree) {
                                                        // eslint-disable-next-line no-console
                                                        console.log('isObject(secondResultKey)', {
                                                            secondDegree: result[key][secondResultKeyKeys[j]],
                                                            resultKey: resultKey,
                                                            isTrue1: secondDegreeValue === resultKey,
                                                            isTrue2: !isObject(secondDegree),
                                                            isTrue3: Array.isArray(secondDegree[resultKey]),
                                                            toAdjust: secondDegree[resultKey]
                                                        });

                                                        if (
                                                            secondDegreeValue === resultKey &&
                                                            !isObject(secondDegree) &&
                                                            Array.isArray(secondDegree[resultKey])
                                                        ) {
                                                            secondDegree[resultKey].length = 0;
                                                        }
                                                    }
                                                }
                                            } else if (isObject(secondDegreeValue)) {
                                                // Third degree
                                                const thirdResultKey = secondResultKey[secondDegreeValueKey];
                                                const thirdResultKeyKeys = Object.keys(thirdResultKey);
                                                const thirdResultKeyValues = Object.values(thirdResultKey);
                                                const thirdResultKeyValuesCount = thirdResultKeyValues.length;

                                                const thirdElmKey = secondDegreeValue;
                                                const thirdElmKeyKeys = Object.keys(thirdElmKey);
                                                const thirdElmKeyValues = Object.values(thirdElmKey);
                                                const thirdElmKeyValuesCount = thirdElmKeyValues.length;

                                                // eslint-disable-next-line no-console
                                                console.log('info', {
                                                    thirdResultKey: thirdResultKey,
                                                    thirdResultKeyKeys: thirdResultKeyKeys,
                                                    thirdResultKeyValues: thirdResultKeyValues,
                                                    thirdResultKeyValuesCount: thirdResultKeyValuesCount,
                                                    thirdElmKey: thirdElmKey,
                                                    thirdElmKeyKeys: thirdElmKeyKeys,
                                                    thirdElmKeyValues: thirdElmKeyValues,
                                                    thirdElmKeyValuesCount: thirdElmKeyValuesCount
                                                });

                                                for (let k = 0; k < thirdResultKeyValuesCount; k++) {
                                                    // Third degree
                                                    const thirdDegreeValue = thirdElmKeyKeys[k] || thirdElmKeyKeys[0];
                                                    // const thirdDegreeValueKey = Object.keys(thirdElmKey)[thirdElmKeyKeys[k] ? j : 0];
                                                    if (
                                                        Array.isArray(thirdDegreeValue) &&
                                                        (thirdDegreeValue as string[]).length === 0
                                                    ) {
                                                        if (isObject(thirdResultKey)) {
                                                            const thirdDegree =
                                                                result[key][secondResultKeyKeys[j]][
                                                                    thirdResultKeyKeys[k]
                                                                ];

                                                            for (const resultKey in thirdDegree) {
                                                                if (
                                                                    thirdDegreeValue === resultKey &&
                                                                    !isObject(thirdDegree) &&
                                                                    Array.isArray(thirdDegree[resultKey])
                                                                ) {
                                                                    thirdDegree[resultKey].length = 0;
                                                                }
                                                            }
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }

                                // eslint-disable-next-line no-console
                                console.log('new', {
                                    'result[key]': result[key],
                                    'elm[key]': elm[key]
                                });
                            }
                            deepMerge(false, result[key], elm[key]);
                        } else {
                            if (Array.isArray(result[key]) && Array.isArray(elm[key])) {
                                if (optCommand) {
                                    // eslint-disable-next-line no-console
                                    console.log('Array.isArray(result[key]) && Array.isArray(elm[key]) - read here');
                                    // eslint-disable-next-line no-console
                                    console.log('elm[key]', {
                                        'elm[key]': elm[key]
                                    });
                                }

                                if (elm[key].length === 0 && optCommand) {
                                    // if using command and it's an empty array, reset to an empty array
                                    // eslint-disable-next-line no-console
                                    console.log('elm[key].length === 0 && optCommand - read here');
                                    result[key] = Array.from(new Set([]));
                                } else {
                                    // concatenate the two arrays and remove any duplicate primitive values
                                    result[key] = Array.from(new Set(result[key].concat(elm[key])));
                                }
                            } else {
                                result[key] = elm[key];
                            }
                        }
                    }
                }
            }
        }
    }

    return result;
};
