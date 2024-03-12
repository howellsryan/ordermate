using ordermateAPI.DAL.Interfaces;
using ordermateAPI.DAL.Models;
using ordermateAPI.Enums;
using ordermateAPI.Exceptions;
using ordermateAPI.Models;
using ordermateAPI.Services.Interfaces;
using ModifierModel = ordermateAPI.DAL.Models.ModifierModel;
using OrderModel = ordermateAPI.Models.OrderModel;
using ProductOptionModel = ordermateAPI.DAL.Models.ProductOptionModel;

namespace ordermateAPI.Services;

public class OrderService : IOrderService
{
    private readonly IOrderRepository _orderRepository;
    private readonly IOrderItemRepository _orderItemRepository;
    private readonly IOrderItemModifierRepository _orderItemModifierRepository;
    private readonly IProductOptionRepository _productOptionRepository;
    private readonly IModifierRepository _modifierRepository;
    private readonly IStoreRepository _storeRepository;

    public OrderService(IOrderRepository orderRepository, IOrderItemRepository orderItemRepository, IOrderItemModifierRepository orderItemModifierRepository,
        IProductOptionRepository productOptionRepository, IModifierRepository modifierRepository, IStoreRepository storeRepository)
    {
        _orderRepository = orderRepository;
        _orderItemRepository = orderItemRepository;
        _orderItemModifierRepository = orderItemModifierRepository;
        _productOptionRepository = productOptionRepository;
        _modifierRepository = modifierRepository;
        _storeRepository = storeRepository;
    }

    public async Task<OrderModel> GetByOrderNumber(string orderNumber)
    {
        DAL.Models.OrderModel? order = await _orderRepository.Get(orderNumber);
        if (order == null)
            throw new OrderNotFoundException($"Could not find an order with the Order Number: {orderNumber}");

        return MapDalObjectToApiModel(order);
    }

    public async Task Create(string email, int storeId)
    {
        if (string.IsNullOrEmpty(email))
            throw new InvalidEmailException("Email Address must be supplied to create an order.");
        
        StoreModel? store = await _storeRepository.Get(storeId);
        if (store == null)
            throw new StoreNotFoundException($"Store with Id {storeId} not found.");
        
        await _orderRepository.Create(email, storeId);
    }

    public async Task AddItem(AddOrderItemModel addOrderItem)
    {
        DAL.Models.OrderModel order = await ValidateOrder(addOrderItem.OrderId);
        ProductOptionModel productOption = await ValidateProductOption(addOrderItem.ProductOptionId);

        foreach (var orderItemModifier in addOrderItem.Modifiers)
        {
            await ValidateModifier(orderItemModifier.ModifierId);
        }

        OrderItemModel? orderItem = await _orderItemRepository.GetByOrderIdAndProductOptionIdAndModifiers(order.OrderId, productOption.ProductOptionId, addOrderItem.Modifiers);
        
        if (orderItem != null)
        {
            addOrderItem.Quantity += orderItem!.Quantity;
            addOrderItem.OrderItemId = orderItem.OrderItemId;
            
            await _orderItemRepository.UpdateItem(addOrderItem);
        }
        else
            await _orderItemRepository.AddItem(addOrderItem);
        
        decimal orderTotal = await CalculateOrderTotal(order.OrderId);
        await _orderRepository.UpdateOrderTotalValue(order.OrderId, orderTotal);
    }

    public async Task UpdateItem(AddOrderItemModel addOrderItem)
    {
        DAL.Models.OrderModel order = await ValidateOrder(addOrderItem.OrderId);
        await ValidateOrderItem(addOrderItem.OrderItemId);
        await ValidateProductOption(addOrderItem.ProductOptionId);
        
        foreach (var orderItemModifier in addOrderItem.Modifiers)
        {
            await ValidateModifier(orderItemModifier.ModifierId);
        }
        
        await _orderItemRepository.UpdateItemAndModifiers(addOrderItem);
        
        decimal orderTotal = await CalculateOrderTotal(order.OrderId);
        await _orderRepository.UpdateOrderTotalValue(order.OrderId, orderTotal);
    }

    public async Task RemoveItem(int orderItemId)
    {
        OrderItemModel orderItem = await ValidateOrderItem(orderItemId);

        await _orderItemRepository.RemoveItem(orderItemId);
        
        decimal orderTotal = await CalculateOrderTotal(orderItem.OrderId);
        await _orderRepository.UpdateOrderTotalValue(orderItem.OrderId, orderTotal);
    }

    private async Task<ordermateAPI.DAL.Models.OrderModel> ValidateOrder(int orderId)
    {
        DAL.Models.OrderModel? order = await _orderRepository.Get(orderId);
        if (order == null)
            throw new OrderNotFoundException($"Could not find an order with Id: {orderId}");

        return order;
    }

    private async Task<ProductOptionModel> ValidateProductOption(int productOptionId)
    {
        ProductOptionModel? productOption = await _productOptionRepository.Get(productOptionId);
        if (productOption == null)
            throw new ProductOptionNotFoundException($"Could not find a product option with Id: {productOptionId}");

        return productOption;
    }

    private async Task<OrderItemModel> ValidateOrderItem(int orderItemId)
    {
        OrderItemModel? orderItem = await _orderItemRepository.Get(orderItemId);
        if (orderItem == null)
            throw new OrderItemNotFoundException($"Could not find an item with Id: {orderItemId}");

        return orderItem;
    }

    private async Task<ModifierModel> ValidateModifier(int modifierId)
    {
        ModifierModel? modifier = await _modifierRepository.Get(modifierId);
        if (modifier == null)
            throw new ModifierNotFoundException($"Could not find a modifier with Id: {modifierId}");

        return modifier;
    }


    private async Task<decimal> CalculateOrderTotal(int orderId)
    {
        IEnumerable<OrderItemModel> orderItems = await _orderItemRepository.GetAllOrderItemsByOrderId(orderId);
        decimal orderTotal = 0;

        foreach (var orderItem in orderItems)
        {
            decimal orderItemTotal = 0;
            ProductOptionModel? productOption = await _productOptionRepository.Get(orderItem.ProductOptionId)!;
            orderItemTotal += productOption!.Price * orderItem.Quantity;

            var orderItemModifiers = await _orderItemModifierRepository.GetAllByOrderItemId(orderItem.OrderItemId);
            foreach (var orderItemModifier in orderItemModifiers)
            {
                ModifierModel? actualModifier = await _modifierRepository.Get(orderItemModifier.ModifierId);
                orderItemTotal += actualModifier!.Price * orderItemModifier.Quantity;
            }

            orderTotal += orderItemTotal;
        }

        return orderTotal;
    }
    
    private List<OrderModel> MapResultsToApi(IEnumerable<DAL.Models.OrderModel> dataModel)
    {
        var result = new List<OrderModel>();

        foreach (var order in dataModel)
        {
            result.Add(MapDalObjectToApiModel(order));
        }

        return result;
    }

    private OrderModel MapDalObjectToApiModel(DAL.Models.OrderModel order)
    {
        return new OrderModel
        {
            OrderId = order.OrderId,
            StoreId = order.StoreId,
            OrderNumber = order.OrderNumber,
            OrderStatus = (OrderStatus)order.OrderStatus,
            Email = order.Email,
            TotalValue = order.TotalValue,
            Notes = order.Notes,
            CompletedDate = order.CompletedDate,
            LastModifiedDate = order.LastModifiedDate,
            CreatedDate = order.CreatedDate
        };
    }
}