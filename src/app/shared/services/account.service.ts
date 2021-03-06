import { Injectable } from '@angular/core';
import { Observable, BehaviorSubject } from 'rxjs';
import Web3 from 'web3';
import KeyringController from 'eth-keyring-controller';
import SimpleKeyring from 'eth-simple-keyring';
import Extension from 'extensionizer';
import EthereumTx from 'ethereumjs-tx';
import ObservableStore from 'obs-store';

@Injectable({
  providedIn: 'root'
})
export class AccountService {
	/*i like lowercase*/
	public extension = Extension;
	//public store = new ObservableStore();

	/*sets the provider to the infura rinkeby node*/
	public web3 = new Web3(new Web3.providers.HttpProvider("https://rinkeby.infura.io/"));

	public keyringController: any;
	public keyring: any;
	public accounts: Object;//BehaviorSubject<Object> = new BehaviorSubject<Object>({});
	public keyringState: any;
	public key: string;
	public user: string;
	public email: string;

	//create an observable that is the state so we can listen to changes
	public accountState: Object = {
		USER: new BehaviorSubject<string>(null),
		EMAIL: new BehaviorSubject<string>(null),
		KEY: new BehaviorSubject<Object>(null)
	};

  constructor(){
  	console.log('listening');

  	try{
	  	chrome.runtime.onConnect.addListener(() =>{
	  		console.log('connected!');
	  	});

	  	chrome.runtime.onMessageExternal.addListener((request, sender, sendResponse) =>{
	  		console.log('external method');
	  	});

	  	chrome.runtime.onMessage.addListener((request, sender, sendResponse) =>{
	  		console.log('got a message!');

	  		console.log(request);
	  		console.log(sender);
	  		console.log(sendResponse);

	  		sendResponse({dismiss: 'bye'});
	  	});
	  } catch(e){
	  	console.log('in browser mode, not adding inpage script');
	  }

  	/*On Instantiation, load the last state of the extension
  	and then instantiate the keyring controller with the
  	resulting state*/
  	this.loadLastState().then((data) => {
  		this.keyringController = new KeyringController({
				keyringTypes: [SimpleKeyring],
				initState: data 
			});

			this.user = data['USER'];
			this.email = data['EMAIL'];

			this.keyringController.signTransaction.bind(this.keyringController);

			console.log(this.keyringController);
  	}, (err) => {console.log(err);});
  }

  /*Account creation only needs password, this needs to return a public key*/
  public async createAccount(email, username, password){
  	//creates a new keyring
  	this.keyring = await this.keyringController.createNewVaultAndKeychain(password);
  	//gets the new state of the keyring
  	this.keyringState = this.keyringController.store.getState();
  	//sets the state of the keyring in storage to be the latest
  	this.setState(this.keyringState).then((data) => {
  		this.accountState['KEY'].next(this.keyringState);
  	}, (err) => {console.log(err)});

  	this.setState({'USER': username}).then((data) => {
  		this.accountState['USER'].next(username);
  	}, (err) => {console.log(err)});

  	this.setState({'EMAIL': email}).then((data) => {
  		this.accountState['EMAIL'].next(email);
		}, (err) => {console.log(err)});
  }

  /*Login only needs to verify the password that should be stored in local storage
  TODO: backup login information on disk in case local storage is lost for some reason
  TODO: implement functionality to regenerate vault from mnoemic if both local and disk storage is unavailable*/
  public login(password){
  	//sets the keyrings to the set of all keyrings after unlock (for us should only be cardinality 1)
  	return new Promise((resolve, reject) => {
  		this.keyring = this.keyringController.unlockKeyrings(password).then((data) => {
		  	this.keyringState = this.keyringController.store.getState();
		  	this.keyringController.fullUpdate();

		  	this.setState(this.keyringState).then((data) => {
		  		this.accountState['KEY'].next(this.keyringState);
		  	}, (err) => {reject(err)});

		  	//get the unlocked accounts
		  	this.keyringController.getAccounts().then(data => {
		  		this.accounts = data;
		  		console.log(this.accounts[0]);
		  		resolve();
		  	});
	  	}, (err) => {
	  		console.log(err);
	  		reject(err);
	  		//do something here to notify user of login issue
	  	});
  	});
  }

  /*Loads the last state from local storage, if local storage doesn't exist, assume undefined last state*/
  public loadLastState(){
  	//chrome's local storage object for extensions
  	let localStorage = this.extension.storage ? this.extension.storage.local : window.localStorage;

  	return new Promise((resolve, reject) => {
  		if(!this.extension.storage){
  			console.log('getting from local');
				resolve(localStorage);
			}
			else{
				//gets all the localstorage data
				console.log('getting from extenion');
		    localStorage.get(null, (result) => {
		      if(this.extension.runtime.lastError){
		      	console.log(this.extension.runtime.lastError);
		        reject(this.extension.runtime.lastError);
		      } 
		      else
		      	//result contains the vault object that holds the users's credentials
		        resolve(result);
		    });
		  }
  	});
  }

  //sets information pertaining to the user's account
  public setState(state){
  	let localStorage = this.extension.storage ? this.extension.storage.local : window.localStorage;

    return new Promise((resolve, reject) => {
    	if(!this.extension.storage){
    		for(let key of Object.keys(state)){
    			localStorage.setItem(key, state[key]);
    		}

				resolve();
			}
			else{
	      localStorage.set(state, () => {
	        if(this.extension.runtime.lastError){
	        	console.log(this.extension.runtime.lastError);
	          reject(this.extension.runtime.lastError);
	        } 
	        else{
	          resolve();
	        }
	      });
	    }
    });
  }

  public createTransactionObject(trx){
  	return new EthereumTx(trx);
  }

  //adress a is the consumer, b is the retailer
  public getValidationArgs(a, b, nonce){
  	let aObj = {t: 'address', v:a};
  	let bObj = {t: 'address', v:b};
  	let nonceObj = {t: 'uint', v:nonce};

  	let hash1 = this.web3.utils.soliditySha3(aObj, bObj, nonceObj);
  	let hash2 = this.web3.utils.soliditySha3('\x19Ethereum Signed Message:\n32', hash1);

  	console.log('keccak1');
  	console.log(hash1);

  	console.log('keccak2');
  	console.log(hash2);

  	return new Promise((resolve, reject) => {
  		this.keyringController.signMessage({from: this.accounts[0], data: hash2}).then((data) => {
	  		console.log(data);

	  		var r = data.substr(0, 66);
	  		var s = '0x' + data.substr(66,64);
	  		var v = '0x' + data.substr(130, 2);

	  		resolve([v, r, s]);
	  	}, (err) => {reject('error signing message: ' + err)});
  	});
  }

  public signTransaction(trx){
  	console.log('signing with: ' + this.accounts[0]);
  	return this.keyringController.signTransaction(trx, this.accounts[0]);
	}

	public getMnemonic(){
		return new Promise((resolve, reject) => {
			var keyring = this.keyringController.getKeyringsByType('HD Key Tree')[0];
			if(!keyring)
				reject("Couldn't find an HD key tree");

			keyring.serialize().then((data) => {
				resolve(data.mnemonic);
			}, (err) => {reject(err);});
		});
	}

	/*Might use this type of functionality to get friends*/
	/*
	public getFriends(){
		var self = this;

		let method = this.contracts['account_util']['contract'].methods.getFriends();

		method.call().then((data) => {
			//how do we want to return friend data? As an address? Or do we want to define
			//a more structured friend object that gives more insight to a user.
			//i.e. an anonymous user you can only view their address/ trades on marketplace
			//but a friend you can also view their inventory and interests.
		})
	}

	public async sendFriendRequest(address: String){
		var self = this;

		let method = this.contracts['account_util']['contract'].methods.addFriend(address);
  	let trx_encode = method.encodeABI();
  	let nonce = await this.web3.eth.getTransactionCount(this.as.accounts[0]);

  	let trx = this.as.createTransactionObject({
  		nonce: this.web3.utils.toHex(nonce),
  		from: this.as.accounts[0],
  		to: '0x28Cb86612875cA99A12ae01924F6311d5b077CD4', //need to change to address of account service
  		gas: this.web3.utils.toHex(5000000),
  		gasPrice: this.web3.utils.toHex(1000000000),
  		data: trx_encode
  	});

  	this.signTransaction(trx).then((data) => {
  		console.log('data');
  		console.log(data);

  		var rawTrx = EthereumUtil.bufferToHex(data.serialize());
  		console.log(rawTrx);

			this.web3.eth.sendSignedTransaction(rawTrx, (err, res) => {
				if(err)
					console.log(err);

				console.log(res);
			}).on('transactionHash', function(hash){
				    console.log('hash: ' + hash);
				})
				.on('receipt', function(receipt){
				    console.log('receipt: ' + receipt);
				})
				.on('confirmation', function(confirmationNumber, receipt){
					console.log('confirmation number: ' + confirmationNumber);
				})
				.on('error', console.error);
	  });
	}
	*/

	/*
	public setData(data){
		this.store.putState(data);
	}

	public getData(){
		return this.store.getState();
	}
	
	public async generateMnemonic(){
		var keyring = this.keyringController.getKeyringsByType('HD Key Tree')[0];
		if(!keyring)
			console.log("Couldn't find an HD key tree");
		
		var serializedKeyring = await keyring.serialize();
		var mnemonic = serializedKeyring.mnemonic; //mnemonic based on the current keyring

		this.setMnemonic(mnemonic);
	}

	public setMnemonic(mnemonic){
		var data = this.getData();
		data.mnemonic = mnemonic;
		this.setData(data);
	}

	public getMnemonic() {
		var data = this.getData();
		return data.mnemonic;
	}*/
}
