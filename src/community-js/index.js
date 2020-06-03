const ethers = require('ethers')

const utf8ToHex = (str) => ethers.utils.hexlify(str.length ? ethers.utils.toUtf8Bytes(str) : 0)
const keccak256 = ethers.utils.keccak256

export class CommunityService {
  // wallet should be an instance of ethers.Wallet
  constructor (contractAbi, contractAddress, wallet) {
    this.factory = new ethers.Contract(contractAddress, contractAbi, wallet)
    this.wallet = wallet
  }

  async createCommunityContract (name, symbol, isOpen) {
    if (!this.templateAddress) this.templateAddress = await this.factory.communityTemplate.call()

    const lockSalt = keccak256(utf8ToHex(name)).substring(0, 26)

    const tx = (await this.factory.createCommunity(name, symbol, isOpen, lockSalt))
    await this.wallet.provider.waitForTransaction(tx.hash)

    const newAddress = this._create2Address(
      this.factory.address,
      this.templateAddress,
      this.wallet.address,
      lockSalt.substring(2)
    )

    return newAddress
  }

  _create2Address (factoryAddress, templateAddress, account, lockSalt) {
    const saltHex = `${account}${lockSalt}`
    const byteCode = `0x3d602d80600a3d3981f3363d3d373d3d3d363d73${templateAddress.replace(
      /0x/,
      ''
    )}5af43d82803e903d91602b57fd5bf3`

    const keccak256 = ethers.utils.keccak256
    const byteCodeHash = keccak256(byteCode)

    const seed = ['ff', factoryAddress, saltHex, byteCodeHash]
      .map(x => x.replace(/0x/, ''))
      .join('')

    const address = keccak256(`0x${seed}`).slice(-40)

    return ethers.utils.getAddress(`0x${address}`)
  }
}
